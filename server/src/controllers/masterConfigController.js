// The Master settings screen's API — `PlatformConfig`, over HTTP.
//
// Every tunable number in the platform already lived in `PlatformConfig` and
// was already read through `getConfigNumber()`. What did not exist was any way
// to *change* one without a developer running a script, which made every
// commercial answer the client gave ("set it from the dashboard at the end")
// undeliverable. This is that delivery mechanism: commission, tax per industry,
// delivery fee, rider pay, subscription fees, the accept window, the lot.
//
// Three rules it enforces, none of them optional:
//
//  · **MASTER only.** Mounted behind `restrictTo('MASTER')`. A district partner
//    changing the commission rate is not a feature.
//  · **A known key, or nothing.** Writes are rejected unless the key is in
//    `CONFIG_KEYS`. `PlatformConfig` is a free-form key/value table, so without
//    this a typo silently creates a row nothing will ever read — which looks
//    exactly like a setting that did not take effect.
//  · **Unset is not zero.** Clearing a key is its own operation (DELETE), and
//    the response distinguishes `value: null` (nobody has decided; render "—")
//    from `value: 0` (someone decided it is free). The manufacturer's
//    subscription fee is the live example of the first.
//
// What it deliberately does NOT do: rewrite history. A delivered order's
// commission split and a delivered job's rider earning are frozen columns
// (`applyCommissionSplit`, `computeRiderEarning`). Changing a rate here affects
// what happens next and nothing that already happened.
import prisma from '../lib/prisma.js';
import {
  CONFIG_KEYS,
  CONFIG_DEFAULTS,
  CONFIG_META,
  setConfig,
  clearConfig
} from '../lib/platformConfig.js';

const KNOWN_KEYS = new Set(Object.values(CONFIG_KEYS));

const parseId = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

/** A number, or null for "unset". Rejects anything else — including "" as 0. */
function parseValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).trim());
  return Number.isFinite(n) ? n : NaN;
}

/**
 * GET /api/master/config
 *
 * Everything the screen needs in one request: each key with its metadata, the
 * global row, every per-industry override, and the default that applies when
 * neither exists. The screen renders groups; it does not decide what a key is.
 */
export const listConfig = async (req, res) => {
  try {
    const [rows, industries] = await Promise.all([
      prisma.platformConfig.findMany({ orderBy: { key: 'asc' } }),
      prisma.industry.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } })
    ]);

    const globalRows = new Map();
    const overrideRows = new Map(); // key -> [{ industryId, value }]
    for (const row of rows) {
      if (!KNOWN_KEYS.has(row.key)) continue; // legacy or hand-inserted junk
      if (row.industryId == null) {
        // One global row per key is enforced by `setConfig`, not by Postgres
        // (NULLs are distinct). Newest wins, matching how `getConfig` resolves.
        const seen = globalRows.get(row.key);
        if (!seen || row.updatedAt > seen.updatedAt) globalRows.set(row.key, row);
      } else {
        const list = overrideRows.get(row.key) ?? [];
        list.push(row);
        overrideRows.set(row.key, list);
      }
    }

    const asNumber = (row) => {
      if (!row) return null;
      const n = Number.parseFloat(row.value);
      return Number.isFinite(n) ? n : null;
    };

    const keys = Object.values(CONFIG_KEYS).map((key) => {
      const meta = CONFIG_META[key] ?? {};
      const globalRow = globalRows.get(key);
      const fallback = CONFIG_DEFAULTS[key];

      return {
        key,
        label: meta.label ?? key,
        group: meta.group ?? 'Other',
        unit: meta.unit ?? '',
        help: meta.help ?? null,
        perIndustry: meta.perIndustry ?? false,

        // What has actually been chosen, and by whom.
        value: asNumber(globalRow),
        isSet: Boolean(globalRow),
        updatedAt: globalRow?.updatedAt ?? null,

        // What the platform falls back to when nothing is set. `null` here is
        // the manufacturer-fee case: no row, no default, and that is on purpose.
        default: fallback ?? null,
        hasDefault: fallback !== undefined,
        effective: asNumber(globalRow) ?? fallback ?? null,

        overrides: (overrideRows.get(key) ?? [])
          .map((row) => ({
            industryId: row.industryId,
            industryName: industries.find((i) => i.id === row.industryId)?.name ?? null,
            value: asNumber(row),
            updatedAt: row.updatedAt
          }))
          .sort((a, b) => (a.industryName ?? '').localeCompare(b.industryName ?? ''))
      };
    });

    const groups = [];
    for (const entry of keys) {
      const group = groups.find((g) => g.name === entry.group);
      if (group) group.keys.push(entry);
      else groups.push({ name: entry.group, keys: [entry] });
    }

    return res.status(200).json({ status: 'success', groups, industries });
  } catch (error) {
    console.error('List Platform Config Error:', error);
    return res.status(500).json({ message: 'Server error loading platform settings.' });
  }
};

/**
 * PUT /api/master/config — `{ key, value, industryId? }`, or `{ updates: [...] }`.
 *
 * A batch is applied one row at a time rather than in a transaction on purpose:
 * these are independent settings, and a bad tenth value should not silently
 * discard nine good edits. The response says exactly which ones landed.
 */
export const updateConfig = async (req, res) => {
  try {
    const updates = Array.isArray(req.body?.updates)
      ? req.body.updates
      : [{ key: req.body?.key, value: req.body?.value, industryId: req.body?.industryId }];

    if (!updates.length) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    const applied = [];
    for (const update of updates) {
      const { key } = update;
      if (!KNOWN_KEYS.has(key)) {
        return res.status(400).json({
          message: `Unknown setting "${key}".`,
          reason: 'UNKNOWN_KEY'
        });
      }

      const industryId = parseId(update.industryId);
      if (Number.isNaN(industryId)) {
        return res.status(400).json({ message: 'Invalid industryId.', reason: 'BAD_INDUSTRY' });
      }
      if (industryId !== null) {
        const exists = await prisma.industry.findUnique({ where: { id: industryId } });
        if (!exists) {
          return res.status(404).json({ message: 'No such industry.', reason: 'BAD_INDUSTRY' });
        }
      }

      const value = parseValue(update.value);
      if (Number.isNaN(value)) {
        return res.status(400).json({
          message: `"${key}" must be a number.`,
          reason: 'BAD_VALUE'
        });
      }

      // Blank clears the row rather than writing 0 — see the file header.
      if (value === null) {
        await clearConfig(key, industryId);
        applied.push({ key, industryId, value: null, cleared: true });
      } else {
        await setConfig(key, value, industryId);
        applied.push({ key, industryId, value, cleared: false });
      }
    }

    return res.status(200).json({ status: 'success', applied });
  } catch (error) {
    console.error('Update Platform Config Error:', error);
    return res.status(500).json({ message: 'Server error saving platform settings.' });
  }
};

/**
 * DELETE /api/master/config/:key?industryId=
 *
 * Falls the key back to what is behind it: an override back to the global row,
 * the global row back to the documented default.
 */
export const deleteConfig = async (req, res) => {
  try {
    const { key } = req.params;
    if (!KNOWN_KEYS.has(key)) {
      return res.status(404).json({ message: `Unknown setting "${key}".`, reason: 'UNKNOWN_KEY' });
    }

    const industryId = parseId(req.query.industryId);
    if (Number.isNaN(industryId)) {
      return res.status(400).json({ message: 'Invalid industryId.', reason: 'BAD_INDUSTRY' });
    }

    const removed = await clearConfig(key, industryId);
    return res.status(200).json({ status: 'success', key, industryId, removed: removed.count });
  } catch (error) {
    console.error('Delete Platform Config Error:', error);
    return res.status(500).json({ message: 'Server error clearing that setting.' });
  }
};
