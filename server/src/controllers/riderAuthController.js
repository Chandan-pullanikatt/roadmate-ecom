// A rider joins RoadMate by asking, and waits for somebody to say yes (2026-08-11).
//
// ── What this replaces ──────────────────────────────────────────────────────
//
// Until today nobody could become a delivery partner without somebody upstream
// typing them in, and whoever typed them in also **chose their password**:
// `createPartner` defaults it to `password123` when the form leaves it blank, and
// `createShopRider` makes the shop invent one and read it out. There was no reset
// endpoint anywhere, so "what is this rider's password" had no answer better than
// "ask whoever created the account, or edit the database".
//
// A rider now applies from the Rider app, and **there is no password at all**.
// Sign-in is the phone number and an OTP, the same credential the applicant used
// to register — which is also the only credential a delivery partner reliably
// has. Nothing here can leak a password because nothing here has one.
//
// ── The flow, and why it is shaped like this ────────────────────────────────
//
//   1. `POST otp/request`  — a code, for this phone, for THIS flow.
//   2. `POST otp/verify`   — one of four outcomes, and the branch is the point:
//        · an approved rider          → signed in, staff JWT, done
//        · an application pending     → told so, and told who is deciding
//        · somebody else's account    → told which app is theirs
//        · nobody                     → a 15-minute signup ticket
//   3. `POST uploads/signature` — licence/Aadhaar photos, ticket-authorised.
//   4. `POST register`     — the application, ticket-authorised, `isActive: false`.
//
// **The phone is proven before the form, not after.** Step 2 mints the ticket and
// steps 3–4 read the phone *out of it*, never out of the body. Asking for the code
// at the end instead would let a stranger file an application against somebody
// else's number and have it sit in a district partner's queue; there is no field
// here in which to name a phone you did not verify.
//
// ── What is deliberately NOT here ───────────────────────────────────────────
//
// **No new approval machinery, and no new guards.** That was the whole reason to
// build it this way. A self-registered rider is an ordinary `EXECUTIVE` /
// `executiveType: 'DELIVERY'` row with `isActive: false`, so:
//
//   · `getPendingApprovals` already lists EXECUTIVE rows for DISTRICT and REGIONAL
//   · `approvePartner` / `rejectPartner` already work on them unchanged
//   · `protect` already refuses an inactive account (403)
//   · `freeRidersNear` already requires `isActive = true`, so a pending applicant
//     is **not assignable** — no order can reach him, with nothing added
//
// A pending applicant is inert because of rules that already existed. The one
// change needed elsewhere was making a rider *visible* to their approver at all:
// see `partnerController` on why the industry filter had to stop applying to
// delivery executives, and `geoController` on why the area is picked and never
// typed.
import prisma from '../lib/prisma.js';
import { normalizePhone } from '../lib/phone.js';
import { issue, verify, OTP_PURPOSE, OTP_TTL_SECONDS } from '../lib/otp.js';
import {
  signRiderSignupToken,
  phoneFromSignupToken,
  RIDER_SIGNUP_TTL_SECONDS
} from '../lib/riderSignupToken.js';
import { signToken, publicUser, USER_INCLUDE } from './authController.js';
import { isOurAsset } from '../lib/cloudinary.js';
import { unusablePassword } from '../lib/password.js';

/**
 * What a rider may say they ride. A closed list, not free text — the approver is
 * reading these in a queue, and `licenceNumber` below is required or not
 * depending on which one it is. Free text would make both of those guesswork.
 */
export const VEHICLE_TYPES = Object.freeze(['Bicycle', 'Bike', 'Scooter', 'Auto', 'Mini Truck']);

/** The ones you need a driving licence to be on a public road with. */
const MOTORISED = Object.freeze(['Bike', 'Scooter', 'Auto', 'Mini Truck']);

const str = (raw, max = 120) =>
  typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : null;

/** 12 digits, however it was typed. Stored digits-only, like the phone number. */
const normalizeAadhaar = (raw) => {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{12}$/.test(digits) ? digits : null;
};

// ── Step 1: a code ──────────────────────────────────────────────────────────

/**
 * POST /api/rider/auth/otp/request
 *
 * Answers the same way for a number that has an account, a number half way
 * through an application and a number nobody has ever seen. Which of the three it
 * is comes back from `verify` — *after* the code proves the caller owns the
 * number. Saying it here would turn this endpoint into a free directory of who
 * drives for RoadMate.
 */
export const requestOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({ message: 'Please provide a valid 10-digit mobile number.' });
    }

    const result = await issue(phone, OTP_PURPOSE.RIDER_SIGNUP);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message, reason: result.reason });
    }

    return res.status(200).json({
      status: 'success',
      message: 'OTP sent.',
      expiresInSeconds: OTP_TTL_SECONDS,
      // ⚠️ Production never sees this — a test pins it. `lib/otp.js` owns the rule.
      ...(result.code ? { code: result.code } : {})
    });
  } catch (error) {
    console.error('Rider OTP Request Error:', error);
    return res.status(500).json({ message: 'Server error while sending the OTP.' });
  }
};

// ── Step 2: who is this? ────────────────────────────────────────────────────

/**
 * POST /api/rider/auth/otp/verify
 *
 * The one endpoint in this file that is interesting, because it is four answers
 * behind one door, and the caller has just proved they own the number — so unlike
 * `requestOtp` it can afford to be specific. Every branch tells the applicant
 * something they can act on:
 *
 *   `SIGNED_IN`   token + user, identical to `POST /api/auth/login`'s shape.
 *   `PENDING`     the application exists; here is when it was filed and which
 *                 desk is deciding. Re-verifying is how a rider checks back, and
 *                 it is why this outcome carries data rather than just a message.
 *   `DEACTIVATED` the account exists and was switched off — an ex-employee a shop
 *                 released, or a partner the platform stood down. A completely
 *                 different sentence from "we have not got to you yet", and
 *                 telling somebody who was removed that they are "pending" would
 *                 have them waiting forever for a decision already made.
 *   `NEW`         a signup ticket. Go and fill the form.
 *
 * A phone belonging to a **shop owner, a manufacturer, a Master** — any non-rider
 * — is a 403 naming the role, so the app can say which app is theirs. That is not
 * a leak: whoever is holding this session owns the number.
 */
export const verifyOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : null;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Please provide a valid mobile number and OTP.' });
    }

    const check = await verify(phone, code, OTP_PURPOSE.RIDER_SIGNUP);
    if (!check.ok) {
      return res.status(check.status).json({ message: check.message, reason: check.reason });
    }

    // `findFirst` rather than `findUnique`: `User.phone` is unique in the schema,
    // but Prisma only offers `findUnique` on fields it knows are unique and this
    // stays correct either way — the same note as `authController.findByIdentifier`.
    const user = await prisma.user.findFirst({ where: { phone }, include: USER_INCLUDE });

    if (!user) {
      return res.status(200).json({
        status: 'success',
        outcome: 'NEW',
        ticket: signRiderSignupToken(phone),
        ticketExpiresInSeconds: RIDER_SIGNUP_TTL_SECONDS,
        // The closed vehicle list comes from the server so the form cannot offer a
        // value `register` will refuse. One table, one source.
        vehicleTypes: VEHICLE_TYPES
      });
    }

    const isRider = user.role === 'EXECUTIVE' && user.executiveType === 'DELIVERY';
    if (!isRider) {
      return res.status(403).json({
        message: 'This number already has a RoadMate account, and it is not a delivery partner.',
        reason: 'WRONG_APP',
        // The app maps a role to an app name (`APP_FOR_ROLE`). Sending the role and
        // not a sentence keeps that mapping in one place instead of two.
        role: user.role,
        executiveType: user.executiveType
      });
    }

    if (user.isActive) {
      return res.status(200).json({
        status: 'success',
        outcome: 'SIGNED_IN',
        token: signToken(user.id, user.role),
        user: publicUser(user)
      });
    }

    // Never approved and nobody's employee → the application is still in a queue.
    // Otherwise this account was *switched off*, which is a decision, not a wait.
    const neverApproved = user.approvedAt === null && user.employerShopId === null;

    if (!neverApproved) {
      return res.status(200).json({
        status: 'success',
        outcome: 'DEACTIVATED',
        // Named, when a shop is who stood him down: "ask Kannan Motors" is
        // actionable and "contact RoadMate" is not.
        employerShop: user.employerShop
          ? { id: user.employerShop.id, name: user.employerShop.businessName || user.employerShop.name }
          : null
      });
    }

    return res.status(200).json({
      status: 'success',
      outcome: 'PENDING',
      application: {
        name: user.name,
        appliedAt: user.createdAt,
        stateName: user.stateName,
        districtName: user.districtName,
        regionName: user.regionName,
        vehicleType: user.vehicleType,
        vehicleNumber: user.vehicleNumber
      }
    });
  } catch (error) {
    console.error('Rider OTP Verify Error:', error);
    return res.status(500).json({ message: 'Server error while verifying the OTP.' });
  }
};

// ── The ticket guard ────────────────────────────────────────────────────────

/**
 * Middleware for the two ticket-authorised routes. Puts the **verified** phone on
 * `req.signupPhone`, which is the only place downstream reads it from.
 */
export const requireSignupTicket = (req, res, next) => {
  const phone = phoneFromSignupToken(req.body?.ticket);
  if (!phone) {
    return res.status(401).json({
      message: 'That registration session has expired. Please verify your mobile number again.',
      reason: 'TICKET_INVALID'
    });
  }
  req.signupPhone = phone;
  next();
};

// ── Step 4: the application ─────────────────────────────────────────────────

/**
 * POST /api/rider/auth/register
 *
 * Creates the pending account. Everything that decides what this row *is* —
 * `role`, `executiveType`, `isActive`, `employerShopId`, `phone` — is set here and
 * **never read from the body**, which is the difference between this endpoint and
 * `createPartner`. `createPartner` takes `role` from its body quite safely,
 * because it sits behind `protect` and a partner can only create downstream of
 * itself; this one is open to the internet, so a `role: 'MASTER'` in the payload
 * has to be something the code cannot express rather than something it checks for.
 */
export const register = async (req, res) => {
  try {
    const phone = req.signupPhone; // from the ticket, never the body

    const name = str(req.body?.name, 80);
    if (!name || name.length < 2) {
      return res.status(400).json({ message: 'Please enter your full name.', reason: 'NAME_REQUIRED' });
    }

    // ── Where he rides ──────────────────────────────────────────────────────
    //
    // Mandatory, and validated against real coverage rather than merely being
    // present. An application whose `districtName` matches no active DISTRICT
    // partner is invisible to every approval queue but MASTER's — see
    // `geoController` for the whole failure. Refusing it here is the only place
    // that can catch a stale picker, a hand-rolled request, or a district partner
    // who was deactivated between the app loading the list and the rider
    // submitting.
    const stateName = str(req.body?.stateName, 80);
    const districtName = str(req.body?.districtName, 80);
    const regionName = str(req.body?.regionName, 80);

    if (!stateName || !districtName) {
      return res.status(400).json({
        message: 'Please choose your state and district.',
        reason: 'AREA_REQUIRED'
      });
    }

    const approver = await prisma.user.findFirst({
      where: { isActive: true, role: 'DISTRICT', stateName, districtName },
      select: { id: true }
    });
    if (!approver) {
      return res.status(400).json({
        message:
          'RoadMate has nobody covering that district yet, so there would be no one to review your application. Please pick your district from the list.',
        reason: 'AREA_NOT_COVERED'
      });
    }

    // A region is optional but not arbitrary: given one, it must be a REGIONAL
    // partner's own, or naming it puts him in a queue that does not exist while
    // looking like it did something.
    if (regionName) {
      const regional = await prisma.user.findFirst({
        where: { isActive: true, role: 'REGIONAL', stateName, districtName, regionName },
        select: { id: true }
      });
      if (!regional) {
        return res.status(400).json({
          message: 'Please pick your area from the list, or leave it blank.',
          reason: 'REGION_NOT_COVERED'
        });
      }
    }

    // ── What he rides, and whether that needs a licence ─────────────────────
    const vehicleType = str(req.body?.vehicleType, 40);
    if (!vehicleType || !VEHICLE_TYPES.includes(vehicleType)) {
      return res.status(400).json({
        message: 'Please choose what you will deliver on.',
        reason: 'VEHICLE_REQUIRED',
        vehicleTypes: VEHICLE_TYPES
      });
    }

    // A bicycle has no plate and needs no licence, and pretending otherwise would
    // either exclude every cycle rider or collect a field of invented numbers.
    const motorised = MOTORISED.includes(vehicleType);
    const vehicleNumber = str(req.body?.vehicleNumber, 20);
    if (motorised && !vehicleNumber) {
      return res.status(400).json({
        message: 'Please enter your vehicle number.',
        reason: 'VEHICLE_NUMBER_REQUIRED'
      });
    }

    const licenceNumber = str(req.body?.licenceNumber, 30);
    if (motorised && !licenceNumber) {
      return res.status(400).json({
        message: 'Please enter your driving licence number.',
        reason: 'LICENCE_REQUIRED'
      });
    }

    // ── Who he is ───────────────────────────────────────────────────────────
    //
    // Aadhaar is required and PAN is not. Aadhaar is the identity the approver is
    // actually checking, and it is the one document essentially every applicant
    // holds; PAN matters only above a tax threshold most riders are under, so
    // requiring it would block people for a number they have no reason to own.
    const aadhaarNumber = normalizeAadhaar(req.body?.aadhaarNumber);
    if (!aadhaarNumber) {
      return res.status(400).json({
        message: 'Please enter your 12-digit Aadhaar number.',
        reason: 'AADHAAR_REQUIRED'
      });
    }
    const panNumber = str(req.body?.panNumber, 15);

    // ── The photographs ────────────────────────────────────────────────────
    //
    // **Optional at the API, and they have to be.** Uploads work only when the
    // deployment carries Cloudinary credentials (`isLive()`); requiring a document
    // photo would make registration impossible on a deployment without file
    // storage, which is the state four phases of this platform shipped in. The app
    // asks for them whenever storage is live and hides the camera when it is not —
    // no affordance that cannot work.
    //
    // What is NOT optional is that a URL be ours. An arbitrary URL here would let
    // an applicant point the approver's browser at anything at all, on a screen
    // whose entire job is looking at a document — the same 400 `NOT_OUR_ASSET` a
    // proof-of-delivery photo gets.
    const docs = {};
    for (const field of ['licenceDocUrl', 'aadhaarDocUrl']) {
      const url = str(req.body?.[field], 500);
      if (!url) continue;
      if (!isOurAsset(url, 'RIDER_DOC')) {
        return res.status(400).json({
          message: 'That document was not uploaded through RoadMate. Please attach it again.',
          reason: 'NOT_OUR_ASSET',
          field
        });
      }
      docs[field] = url;
    }

    // ── Where the money goes ───────────────────────────────────────────────
    //
    // Optional. The platform pays every rider weekly (`runRiderSettlement`), but
    // that is days after approval at the earliest, and an applicant who does not
    // know their IFSC by heart must not be stopped at the door over it. Collected
    // here because it is one form rather than two, and left blank without
    // complaint.
    const upiId = str(req.body?.upiId, 60);
    const accountNumber = str(req.body?.accountNumber, 30);
    const ifscCode = str(req.body?.ifscCode, 15);
    const accountHolder = str(req.body?.accountHolder, 80) ?? name;
    const bankName = str(req.body?.bankName, 80);

    // Re-checked here and not only in `verifyOtp`: the ticket is good for fifteen
    // minutes, and a shop could add this very phone as its own delivery boy in
    // between. The unique index on `User.phone` is the real backstop; this turns
    // what would be a 500 into a sentence.
    const taken = await prisma.user.findFirst({ where: { phone }, select: { id: true } });
    if (taken) {
      return res.status(409).json({
        message: 'This number already has a RoadMate account. Go back and sign in with it.',
        reason: 'PHONE_TAKEN'
      });
    }

    const rider = await prisma.user.create({
      data: {
        // Never typed by anybody. `email` is unique and non-null in the schema and
        // the phone number is what this person signs in with — the same synthetic
        // address `createShopRider` mints, with `self` where the shop id goes.
        email: `rider-${phone}@self.roadmate.local`,
        // ⚠️ There is no password on a self-registered rider and there must not
        // be one. `lib/password.js` explains what this value is and why sign-in by
        // password is closed rather than merely unset.
        password: await unusablePassword(),
        name,
        phone,

        // Hard-coded, never from the body. See the doc comment.
        role: 'EXECUTIVE',
        executiveType: 'DELIVERY',
        // The whole point: he cannot trade, cannot sign in, and cannot be assigned
        // an order until a district or regional partner approves him.
        isActive: false,
        // A RoadMate delivery partner, in the platform pool. A shop's own delivery
        // boy is hired by his shop and never arrives through this door (HANDOFF §3).
        employerShopId: null,

        country: 'India',
        stateName,
        districtName,
        regionName,

        // ⚠️ NULL on purpose, and the one field here that looks like an omission.
        //
        // Delivery is cross-industry: `freeRidersNear` passes `industryId` only to
        // look up `rider_range_km` and does **not** filter riders by it, so the
        // same rider carries a grocery order and a pharmacy order and the column
        // changes nothing about who he is offered. Asking an applicant to pick one
        // would be collecting an answer with no consequence, and then quietly
        // giving it one — the approval queues used to filter on it, which is
        // exactly why a value here would have hidden him from half the desks that
        // should see him. `partnerController` stopped applying that filter to
        // delivery executives instead.
        industryId: null,
        // Nobody onboarded him; he applied. This is what distinguishes a
        // self-registered rider from an executive-onboarded one, with no extra
        // column needed to say so.
        parentId: null,

        vehicleType,
        vehicleNumber,
        licenceNumber,
        aadhaarNumber,
        panNumber,
        ...docs,

        upiId,
        accountNumber,
        ifscCode,
        accountHolder,
        bankName
      },
      select: { id: true, name: true, createdAt: true, districtName: true, regionName: true }
    });

    return res.status(201).json({
      status: 'success',
      outcome: 'PENDING',
      message:
        'Your application has been sent. You will be able to sign in as soon as RoadMate approves it.',
      application: {
        name: rider.name,
        appliedAt: rider.createdAt,
        districtName: rider.districtName,
        regionName: rider.regionName
      }
    });
  } catch (error) {
    console.error('Rider Register Error:', error);
    return res.status(500).json({ message: 'Server error while sending your application.' });
  }
};
