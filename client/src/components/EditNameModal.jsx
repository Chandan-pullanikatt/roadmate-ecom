import React, { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import { updateMyName } from '../utils/api';

/**
 * "Change your display name", from the user card at the foot of the sidebar.
 *
 * Lives in `Sidebar` rather than on any one dashboard's settings screen, because
 * all seven portals render that same sidebar and only MASTER has a settings
 * screen at all. One component, seven portals.
 *
 * The name shown in the sidebar is `roadmate_user.name` out of localStorage, and
 * `updateMyName` rewrites that key — so `onSaved` only has to push the new name
 * into React state for the sidebar to update without a reload.
 */
const EditNameModal = ({ isOpen, currentName = '', onClose, onSaved }) => {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reopening after a cancel should offer the stored name again, not whatever
  // was half-typed last time.
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      setError(null);
      setSaving(false);
    }
  }, [isOpen, currentName]);

  const trimmed = name.trim().replace(/\s+/g, ' ');
  // The same 2–80 the endpoint enforces, so the disabled button and the 400 tell
  // one story.
  const isValid = trimmed.length >= 2 && trimmed.length <= 80;
  const isUnchanged = trimmed === currentName.trim();

  const handleSave = async () => {
    if (!isValid || isUnchanged || saving) return;
    setSaving(true);
    setError(null);
    try {
      const data = await updateMyName(trimmed);
      onSaved?.(data.user.name);
      onClose?.();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'Could not save the name. Check your connection and try again.'
      );
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={saving ? undefined : onClose}
      title="Change Display Name"
      subtitle="The name shown on your dashboard and to the partners you approve"
      width="460px"
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!isValid || isUnchanged || saving}
          >
            {saving ? 'Saving…' : 'Save Name'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor="display-name">
          Full Name <span>*</span>
        </label>
        <input
          id="display-name"
          className="form-input"
          type="text"
          autoFocus
          maxLength={80}
          value={name}
          placeholder="e.g. Narendra Kumar"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
          disabled={saving}
        />
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Only your display name changes. Your email address and mobile number
          are what you sign in with, so they are not editable here.
        </p>
      </div>

      {error && (
        <p role="alert" style={{ margin: '12px 0 0', fontSize: '13px', color: '#b91c1c' }}>
          {error}
        </p>
      )}
    </Modal>
  );
};

export default EditNameModal;
