# PoolFi web app

The PoolFi web app, built from the desktop design (the Figma exports) and the prototype. Next.js 16 (App Router), React 19, TypeScript, CSS Modules.

It currently runs on **sample data** stored in your browser, so every screen can be reviewed before it is connected to the server and the contract.

## Run it

Requires Node.js 22 or newer.

```sh
cd web
npm install
npm run dev        # http://localhost:3000
```

`npm run build` makes a production build, and `npm run lint` checks the code.

### Signing in with sample data

Any 6-digit code works. No message is sent.

| Who | Phone | Sees |
|---|---|---|
| Judith Okafor | 803 555 0142 (or `judith.okafor@gmail.com`) | Lifeguard of two pools, diver in one, approver in one, plus a paid-out and a refunded pool |
| Tayo Adeyemi | 816 555 0199 | A diver who can pay into Judith's class dues (invite link `/p/PF-7K2Q`) |

Any other phone number or email creates a new account and goes through profile setup.

The sample data lives in your browser's local storage. To start again from scratch, clear this site's data in the browser (or run `localStorage.removeItem("poolfi-sample-v1")` in the console).

The sample data also simulates what the backend will do:
- Approvers approve a requested payout a few seconds after it is requested.
- Pools that miss their deadline are refunded.
- Receipts get real references that the `/r/<ref>` page can check.

## Settings

All optional, in `web/.env.local`:

| Variable | Default | What it does |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | the current site | Base for invite links, receipt QR codes and statement links |
| `NEXT_PUBLIC_SIGNIN_METHODS` | `phone,email` | Sign-in options on the sign-up screen (`email`, `phone` or both) |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` | On `testnet` the wallet shows an "Add 10 test USDC" button |
| `NEXT_PUBLIC_NGN_PER_USDC` | `1400` | Rate used to turn the design's Naira presets into USDC |
| `NEXT_PUBLIC_FEE_BPS` | `500` | PoolFi fee shown while creating a pool (5%) |

## Layout

```text
web/src
├── app/                  one folder per screen (see below)
├── components/
│   ├── shells.tsx        page frames: sidebar app, sign-up, invite, step-by-step
│   ├── ui.tsx            buttons, pills, modals, loading, error and empty states
│   ├── pool.tsx          pool rows, diver rows, the water tank
│   ├── wallet.tsx        deposit panel and "Add funds"
│   ├── share.tsx         share and remind modals
│   ├── people.tsx        adding people: contacts, pasted list, file upload
│   ├── Drip.tsx, Icon.tsx
│   └── providers.tsx     signed-in user and toasts
└── lib/
    ├── api.ts            every call the app makes (the PoolFiApi interface)
    ├── sample.ts         SAMPLE DATA: the only file to delete when connecting the backend
    ├── types.ts          shapes of the data the API returns
    ├── money.ts          USDC formatting, fee maths
    ├── people.ts         parsing names, Nigerian phone numbers and emails from lists and files
    ├── receipt-image.ts, record-files.ts   receipt image, statement PDF, summary image, CSV
    └── format.ts, hooks.ts, errors.ts
```

## Animations

All motion comes from the prototype, with the same keyframes, timings and easing.
- `src/app/motion.css` holds the keyframes and classes.
- `src/components/motion.tsx` holds the effects: confetti, coin rain, the paper plane, coins dropping into the tank, count-ups, the full-screen celebration, the badge pop-up and the splash.

| Where | What moves |
|---|---|
| Opening the app | Splash: the pool fills and the logo springs in, each time the app opens or reloads; tap to skip |
| Sign-up panel | Coins bob around Drip, the story changes every few seconds, waves drift |
| Everywhere | Pages slide or fade in, buttons ripple, rows rise in turn, modals and toasts spring in and out, Drip bobs and blinks |
| Home and wallet | Balance counts up, waves drift behind it, alerts pulse, the bell rings while something needs you |
| Pool page | The tank fills and counts up. A coin drops in for each payment since your last visit, or one that lands while you watch, and those rows slide in highlighted. A refunded pool drains |
| Pool fills up | Lifeguard's "is full." celebration, once |
| Create a pool | Steps slide, the amount bumps per key, "Filling your pool…", then "Your pool is live." with confetti and coins |
| Paying | "Confirming your payment…" rings, then "You're in!" with a tick that draws itself, confetti, coins and the Early diver badge |
| Approving | Hold the key until it turns, confetti, then "Approved. Thank you." |
| Payout | Approvals tick in with a toast each, then "Payout landed." with the amount counting up |

People whose system asks for reduced motion get none of this, including the splash.

### Sound effects

The prototype's sounds are short tones made in the browser (`src/lib/sound.ts`), so there are no audio files. They're on by default; Settings has a switch, remembered on each device. Browsers only allow sound after the first click, so nothing plays before that.

| Sound | When |
|---|---|
| Tap | Any button or link |
| Pick | Choosing a tile, chip, option, toggle, tab or payment method; Continue in the create flow |
| Coin, then plop | A payment drops into the tank and lands |
| Nope | Something shakes: too many digits, a fourth approver, a wrong code |
| Send | Reminders or invites fly off |
| Win | Right code, an approval arriving, a list added, test USDC landing, a receipt that checks out, a badge, the key turning |
| Fanfare | Every full-screen celebration and "You're in!" |

On phones that support it, the bigger moments also buzz.

## Connecting the backend

Every screen talks to `api` in `src/lib/api.ts` and nothing else. Today it is:

```ts
export const api: PoolFiApi = sampleApi;
```

To connect the real backend:
1. Write a `PoolFiApi` implementation that calls the server, with Supabase email codes for sign-in.
2. Point `api` at it.
3. Delete `src/lib/sample.ts`.

No screen needs to change. The interface and `types.ts` are the contract between the web app and the server.

## Screens

| Route | Screen |
|---|---|
| `/` | Welcome |
| `/signup`, `/signup/verify`, `/signup/profile` | Sign up or log in, 6-digit code, profile (name plus emoji or photo) |
| `/home` | Balance, alerts, open pools, recent activity |
| `/create` | Create a pool in 8 steps: type, name, amount and fee, details, deadline, approvers, add people, review |
| `/pools` | My pools, open and closed |
| `/pools/[id]` | A pool, depending on who is looking: the lifeguard (divers, activity, details, share, remind), a diver, an approver, or a refunded diver |
| `/pools/[id]/divers` | Add divers from contacts, a pasted list or a file |
| `/pools/[id]/payout`, `/pools/[id]/payout/status` | Request the payout, then wait for approvers until it lands |
| `/pools/[id]/approve` | Hold to approve, or decline with a reason |
| `/pools/[id]/record` | The pool's record: statement PDF, summary image, CSV |
| `/p/[code]`, `/p/[code]/paid` | Invite link: find your name, pay, top up if needed, then the paid screen with badges |
| `/receipts/[ref]` | Receipt, downloadable as an image |
| `/r/[ref]` | Public receipt check (the receipt's QR code points here) |
| `/wallet` | USDC balance, Stellar wallet address, deposit, transactions |
| `/activity`, `/notifications`, `/settings` | Sidebar pages |

### Where it differs from the design

- **USDC only.** Naira amounts in the design were converted at 1 USDC = ₦1,400 (₦2,800 → 2 USDC). Bank transfer, Naira deposits and bank payouts open a "Coming soon" modal.
- **Stellar, not Base.** Wallet text and addresses are Stellar.
- **Amount keypad.** The "00" key is a "." key, because USDC has cents.
- **Sign-in codes.** Sign-in is by phone or email code. Email (through Supabase) comes first once connected.
- **Desktop only for now.** The mobile design comes next.
