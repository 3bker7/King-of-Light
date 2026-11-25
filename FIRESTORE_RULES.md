# Noor Al-Shaab — Firestore Security Rules (Prompt 8)

Copy and paste the rules block below into **Firebase Console → Firestore Database → Rules** when enabling the Shared World (`src/net/firebaseConfig.ts`).

> **Rule of Completeness (Harden 0):** Every collection used by the client is enumerated below. No collection exists outside this table.

## Collection Access Matrix

| Collection Path | Read | Write | Key Invariants Enforced |
| :--- | :--- | :--- | :--- |
| `worldKingdoms/{uid}` | Any signed-in user | Owner `uid` only (`create`, `update`; no `delete`) | Exact gold is **forbidden** (`!('gold' in data)`). Only `goldBand in ['poor','mid','rich']`. `wx`/`wy` immutable after create. Bounded `nameAr` (<=40), `rulerName` (<=32), `reputation` (0..100), `population` (0..100000), `provincesCount` (0..6). |
| `worldCells/{cellKey}` | Any signed-in user | Authenticated user (`create` only; no `update`/`delete`) | Prevents position squatting: `cellKey == wx + '_' + wy`, `uid == request.auth.uid`, document must not already exist. |
| `cloudKingdoms/{uid}` | Owner `uid` only | Owner `uid` only (`create`, `update`, `delete`) | Self-regarding backup only; `saveJson` string <= 900,000 bytes; `totalMonths >= 0`; `updatedAt` number. |
| `worldBourse/current` | Any signed-in user | Signed-in user via **two** transaction shapes only | **(A) Volume increment:** `day`, `prices`, `inflationIndex` unchanged; each resource's `dailyBought`/`dailySold` increases by `0..500`. **(B) Day roll:** `day == prev.day + 1`, all volumes reset to `0`, all 16 prices within Prompt 2 Level 2 bands `[max(1, floor(base*0.6)), ceil(base*1.6)]`. |
| `worldBourseVolumes/{dayUid}` | Owner `uid` only | Owner `uid` only (`create`, `update`) | Enforces per-kingdom daily volume cap of **500 units per resource** per world day (`dayUid == day + '_' + uid`). |
| `worldPalace/current` | Any signed-in user | Signed-in user (`create`, `update` monotonic add only) | World fees flow IN only: `gold >= prev.gold` and delta `<= 100000`. Clients cannot withdraw or burn World Palace gold. |
| `marketListings/{listingId}` | Any signed-in user | Seller (`create`/`update`/`delete`) OR Buyer claim (`update` qty decrease only) | `qty` in `1..10000`, `unitPrice` inside Prompt 2 bands for `resource`. Buyer claim may ONLY reduce `qty` (never change `sellerUid`, `resource`, `unitPrice`, `createdDay`, `expiresDay`, `embassyOnly`). |
| `embassies/{agreementId}` | Signed-in user (host or guest, or directory read) | `hostUid` or `guestUid` only | Valid status in `['pending','active','suspended','dissolved']`, `priceAgreed >= 0 && <= 100000`, `feeArrearsMonths >= 0 && <= 12`. |
| `worldKingdoms/{destUid}/visas/{visaId}` | Destination `destUid` or sender `fromUid` | Sender `fromUid` (`create` with `status == 'pending'`); Destination `destUid` (`update` status only) | Prevents forging sender identity or self-approving visas. |
| `worldNewsletters/{day}` | Any signed-in user | Signed-in user (`create` once per day only; immutable) | `lines` list length `1..20`, `day >= 1`. |

---

## Copy-Paste `firestore.rules`

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }

    function isIntInRange(v, lo, hi) {
      return v is int && v >= lo && v <= hi;
    }

    function isNumInRange(v, lo, hi) {
      return (v is int || v is float) && v >= lo && v <= hi;
    }

    function isValidResource(r) {
      return r in [
        'fish', 'crops', 'wheat', 'fruit', 'meat', 'bread',
        'wood', 'water', 'stone', 'iron', 'copper', 'goldOre',
        'gem', 'tools', 'jewelry', 'oil'
      ];
    }

    // Prompt 2 BASE_BUY_PRICES with Level 2 bands: lo = max(1, floor(base * 0.6)), hi = ceil(base * 1.6)
    function isValidPriceForResource(r, p) {
      return p is int && (
        (r == 'fish'    && p >= 3   && p <= 10)  ||
        (r == 'crops'   && p >= 3   && p <= 8)   ||
        (r == 'wheat'   && p >= 3   && p <= 8)   ||
        (r == 'fruit'   && p >= 4   && p <= 13)  ||
        (r == 'meat'    && p >= 5   && p <= 15)  ||
        (r == 'bread'   && p >= 7   && p <= 20)  ||
        (r == 'wood'    && p >= 2   && p <= 7)   ||
        (r == 'water'   && p >= 1   && p <= 4)   ||
        (r == 'stone'   && p >= 4   && p <= 12)  ||
        (r == 'iron'    && p >= 8   && p <= 23)  ||
        (r == 'copper'  && p >= 10  && p <= 29)  ||
        (r == 'goldOre' && p >= 36  && p <= 96)  ||
        (r == 'gem'     && p >= 72  && p <= 192) ||
        (r == 'tools'   && p >= 24  && p <= 64)  ||
        (r == 'jewelry' && p >= 132 && p <= 352) ||
        (r == 'oil'     && p >= 15  && p <= 40)
      );
    }

    function allBoursePricesValid(prices) {
      return prices is map
        && prices.keys().hasOnly([
          'fish', 'crops', 'wheat', 'fruit', 'meat', 'bread',
          'wood', 'water', 'stone', 'iron', 'copper', 'goldOre',
          'gem', 'tools', 'jewelry', 'oil'
        ])
        && isValidPriceForResource('fish', prices.fish)
        && isValidPriceForResource('crops', prices.crops)
        && isValidPriceForResource('wheat', prices.wheat)
        && isValidPriceForResource('fruit', prices.fruit)
        && isValidPriceForResource('meat', prices.meat)
        && isValidPriceForResource('bread', prices.bread)
        && isValidPriceForResource('wood', prices.wood)
        && isValidPriceForResource('water', prices.water)
        && isValidPriceForResource('stone', prices.stone)
        && isValidPriceForResource('iron', prices.iron)
        && isValidPriceForResource('copper', prices.copper)
        && isValidPriceForResource('goldOre', prices.goldOre)
        && isValidPriceForResource('gem', prices.gem)
        && isValidPriceForResource('tools', prices.tools)
        && isValidPriceForResource('jewelry', prices.jewelry)
        && isValidPriceForResource('oil', prices.oil);
    }

    function allVolumesZero(vols) {
      return vols is map
        && vols.fish == 0 && vols.crops == 0 && vols.wheat == 0
        && vols.fruit == 0 && vols.meat == 0 && vols.bread == 0
        && vols.wood == 0 && vols.water == 0 && vols.stone == 0
        && vols.iron == 0 && vols.copper == 0 && vols.goldOre == 0
        && vols.gem == 0 && vols.tools == 0 && vols.jewelry == 0
        && vols.oil == 0;
    }

    function volumeDeltaBounded(prevVols, nextVols, r) {
      let prevV = (r in prevVols && prevVols[r] is int) ? prevVols[r] : 0;
      let nextV = (r in nextVols && nextVols[r] is int) ? nextVols[r] : 0;
      return nextV >= prevV && (nextV - prevV) <= 500;
    }

    function allVolumeDeltasBounded(prevVols, nextVols) {
      return nextVols is map
        && volumeDeltaBounded(prevVols, nextVols, 'fish')
        && volumeDeltaBounded(prevVols, nextVols, 'crops')
        && volumeDeltaBounded(prevVols, nextVols, 'wheat')
        && volumeDeltaBounded(prevVols, nextVols, 'fruit')
        && volumeDeltaBounded(prevVols, nextVols, 'meat')
        && volumeDeltaBounded(prevVols, nextVols, 'bread')
        && volumeDeltaBounded(prevVols, nextVols, 'wood')
        && volumeDeltaBounded(prevVols, nextVols, 'water')
        && volumeDeltaBounded(prevVols, nextVols, 'stone')
        && volumeDeltaBounded(prevVols, nextVols, 'iron')
        && volumeDeltaBounded(prevVols, nextVols, 'copper')
        && volumeDeltaBounded(prevVols, nextVols, 'goldOre')
        && volumeDeltaBounded(prevVols, nextVols, 'gem')
        && volumeDeltaBounded(prevVols, nextVols, 'tools')
        && volumeDeltaBounded(prevVols, nextVols, 'jewelry')
        && volumeDeltaBounded(prevVols, nextVols, 'oil');
    }

    // 1. Public Kingdom Registry (goldBand ONLY — exact gold is strictly rejected)
    match /worldKingdoms/{uid} {
      allow read: if isSignedIn();
      allow create: if isOwner(uid)
        && request.resource.data.keys().hasOnly([
          'uid', 'nameAr', 'rulerName', 'wx', 'wy',
          'reputation', 'population', 'provincesCount', 'goldBand', 'updatedAt'
        ])
        && request.resource.data.uid == uid
        && request.resource.data.nameAr is string && request.resource.data.nameAr.size() >= 1 && request.resource.data.nameAr.size() <= 40
        && request.resource.data.rulerName is string && request.resource.data.rulerName.size() >= 1 && request.resource.data.rulerName.size() <= 32
        && isIntInRange(request.resource.data.wx, -1000, 1000)
        && isIntInRange(request.resource.data.wy, -1000, 1000)
        && isNumInRange(request.resource.data.reputation, 0, 100)
        && isIntInRange(request.resource.data.population, 0, 100000)
        && isIntInRange(request.resource.data.provincesCount, 0, 6)
        && request.resource.data.goldBand in ['poor', 'mid', 'rich']
        && request.resource.data.updatedAt is int;

      allow update: if isOwner(uid)
        && request.resource.data.keys().hasOnly([
          'uid', 'nameAr', 'rulerName', 'wx', 'wy',
          'reputation', 'population', 'provincesCount', 'goldBand', 'updatedAt'
        ])
        && request.resource.data.uid == uid
        && request.resource.data.wx == resource.data.wx
        && request.resource.data.wy == resource.data.wy
        && request.resource.data.nameAr is string && request.resource.data.nameAr.size() >= 1 && request.resource.data.nameAr.size() <= 40
        && request.resource.data.rulerName is string && request.resource.data.rulerName.size() >= 1 && request.resource.data.rulerName.size() <= 32
        && isNumInRange(request.resource.data.reputation, 0, 100)
        && isIntInRange(request.resource.data.population, 0, 100000)
        && isIntInRange(request.resource.data.provincesCount, 0, 6)
        && request.resource.data.goldBand in ['poor', 'mid', 'rich']
        && request.resource.data.updatedAt is int;

      allow delete: if false;

      // 9. Visa Applications subcollection (readable by destination kingdom or sender)
      match /visas/{visaId} {
        allow read: if isSignedIn() && (request.auth.uid == uid || resource.data.fromUid == request.auth.uid);
        allow create: if isSignedIn()
          && request.resource.data.fromUid == request.auth.uid
          && request.resource.data.fromUid != uid
          && request.resource.data.status == 'pending'
          && request.resource.data.month is int && request.resource.data.month >= 0
          && request.resource.data.citizenSnapshot is map;
        allow update: if isOwner(uid)
          && request.resource.data.fromUid == resource.data.fromUid
          && request.resource.data.month == resource.data.month
          && request.resource.data.citizenSnapshot == resource.data.citizenSnapshot
          && request.resource.data.status in ['approved', 'rejected', 'expired'];
        allow delete: if false;
      }
    }

    // 2. Atomic World Spawn Cell Locks (prevents position squatting)
    match /worldCells/{cellKey} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && request.resource.data.keys().hasOnly(['uid', 'wx', 'wy', 'createdAt'])
        && request.resource.data.uid == request.auth.uid
        && isIntInRange(request.resource.data.wx, -1000, 1000)
        && isIntInRange(request.resource.data.wy, -1000, 1000)
        && cellKey == (string(request.resource.data.wx) + '_' + string(request.resource.data.wy))
        && request.resource.data.createdAt is int;
      allow update, delete: if false;
    }

    // 3. Private Cloud Save (self-regarding backup; only owner may read/write)
    match /cloudKingdoms/{uid} {
      allow read: if isOwner(uid);
      allow create, update: if isOwner(uid)
        && request.resource.data.keys().hasOnly(['saveJson', 'updatedAt', 'totalMonths'])
        && request.resource.data.saveJson is string
        && request.resource.data.saveJson.size() <= 900000
        && request.resource.data.totalMonths is int && request.resource.data.totalMonths >= 0
        && request.resource.data.updatedAt is int;
      allow delete: if isOwner(uid);
    }

    // 4. Shared World Bourse (ONE doc: worldBourse/current)
    match /worldBourse/current {
      allow read: if isSignedIn();

      allow create: if isSignedIn()
        && request.resource.data.day == 1
        && allBoursePricesValid(request.resource.data.prices)
        && allVolumesZero(request.resource.data.dailyBought)
        && allVolumesZero(request.resource.data.dailySold)
        && isIntInRange(request.resource.data.inflationIndex, 20, 400);

      allow update: if isSignedIn() && (
        // Shape A: Volume increment transaction — prices, day, and inflationIndex are IMMUTABLE
        (
          request.resource.data.day == resource.data.day
          && request.resource.data.prices == resource.data.prices
          && request.resource.data.inflationIndex == resource.data.inflationIndex
          && allVolumeDeltasBounded(resource.data.dailyBought, request.resource.data.dailyBought)
          && allVolumeDeltasBounded(resource.data.dailySold, request.resource.data.dailySold)
        )
        ||
        // Shape B: World day-roll transaction — day increments by exactly 1, volumes reset to 0, prices clamped
        (
          request.resource.data.day == resource.data.day + 1
          && allBoursePricesValid(request.resource.data.prices)
          && allVolumesZero(request.resource.data.dailyBought)
          && allVolumesZero(request.resource.data.dailySold)
          && isIntInRange(request.resource.data.inflationIndex, 20, 400)
        )
      );

      allow delete: if false;
    }

    // 5. Per-Kingdom Daily Bourse Volume Guard (<= 500 units per resource per world day)
    match /worldBourseVolumes/{dayUid} {
      allow read: if isSignedIn() && (
        (resource != null && resource.data.uid == request.auth.uid)
        || dayUid.matches('^[0-9]+_' + request.auth.uid + '$')
      );
      allow create, update: if isSignedIn()
        && request.resource.data.keys().hasOnly(['uid', 'day', 'counts', 'updatedAt'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.day is int && request.resource.data.day >= 1
        && dayUid == (string(request.resource.data.day) + '_' + request.auth.uid)
        && request.resource.data.counts is map
        && (!('fish' in request.resource.data.counts)    || isIntInRange(request.resource.data.counts.fish, 0, 500))
        && (!('crops' in request.resource.data.counts)   || isIntInRange(request.resource.data.counts.crops, 0, 500))
        && (!('wheat' in request.resource.data.counts)   || isIntInRange(request.resource.data.counts.wheat, 0, 500))
        && (!('fruit' in request.resource.data.counts)   || isIntInRange(request.resource.data.counts.fruit, 0, 500))
        && (!('meat' in request.resource.data.counts)    || isIntInRange(request.resource.data.counts.meat, 0, 500))
        && (!('bread' in request.resource.data.counts)   || isIntInRange(request.resource.data.counts.bread, 0, 500))
        && (!('wood' in request.resource.data.counts)    || isIntInRange(request.resource.data.counts.wood, 0, 500))
        && (!('water' in request.resource.data.counts)   || isIntInRange(request.resource.data.counts.water, 0, 500))
        && (!('stone' in request.resource.data.counts)   || isIntInRange(request.resource.data.counts.stone, 0, 500))
        && (!('iron' in request.resource.data.counts)    || isIntInRange(request.resource.data.counts.iron, 0, 500))
        && (!('copper' in request.resource.data.counts)  || isIntInRange(request.resource.data.counts.copper, 0, 500))
        && (!('goldOre' in request.resource.data.counts) || isIntInRange(request.resource.data.counts.goldOre, 0, 500))
        && (!('gem' in request.resource.data.counts)     || isIntInRange(request.resource.data.counts.gem, 0, 500))
        && (!('tools' in request.resource.data.counts)   || isIntInRange(request.resource.data.counts.tools, 0, 500))
        && (!('jewelry' in request.resource.data.counts) || isIntInRange(request.resource.data.counts.jewelry, 0, 500))
        && (!('oil' in request.resource.data.counts)     || isIntInRange(request.resource.data.counts.oil, 0, 500));
      allow delete: if false;
    }

    // 6. World Palace Treasury (fees flow IN only; monotonic non-negative delta)
    match /worldPalace/current {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && request.resource.data.keys().hasOnly(['gold'])
        && isIntInRange(request.resource.data.gold, 0, 100000);
      allow update: if isSignedIn()
        && request.resource.data.keys().hasOnly(['gold'])
        && request.resource.data.gold is int
        && request.resource.data.gold >= resource.data.gold
        && (request.resource.data.gold - resource.data.gold) <= 100000;
      allow delete: if false;
    }

    // 7. Player-to-Player Market Listings
    match /marketListings/{listingId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && request.resource.data.sellerUid == request.auth.uid
        && isValidResource(request.resource.data.resource)
        && isIntInRange(request.resource.data.qty, 1, 10000)
        && isValidPriceForResource(request.resource.data.resource, request.resource.data.unitPrice)
        && request.resource.data.embassyOnly is bool
        && request.resource.data.createdDay is int
        && request.resource.data.expiresDay is int
        && request.resource.data.expiresDay >= request.resource.data.createdDay;

      allow update: if isSignedIn() && (
        // Seller edit
        (
          resource.data.sellerUid == request.auth.uid
          && request.resource.data.sellerUid == resource.data.sellerUid
          && isValidResource(request.resource.data.resource)
          && isIntInRange(request.resource.data.qty, 0, 10000)
          && isValidPriceForResource(request.resource.data.resource, request.resource.data.unitPrice)
        )
        ||
        // Buyer claim transaction: may ONLY decrease qty, all listing terms immutable
        (
          resource.data.sellerUid != request.auth.uid
          && request.resource.data.sellerUid == resource.data.sellerUid
          && request.resource.data.sellerNameAr == resource.data.sellerNameAr
          && request.resource.data.resource == resource.data.resource
          && request.resource.data.unitPrice == resource.data.unitPrice
          && request.resource.data.createdDay == resource.data.createdDay
          && request.resource.data.expiresDay == resource.data.expiresDay
          && request.resource.data.embassyOnly == resource.data.embassyOnly
          && request.resource.data.qty is int
          && request.resource.data.qty >= 0
          && request.resource.data.qty < resource.data.qty
        )
      );

      allow delete: if isSignedIn() && resource.data.sellerUid == request.auth.uid;
    }

    // 8. Embassy Agreements (host or guest only)
    match /embassies/{agreementId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && (request.resource.data.hostUid == request.auth.uid || request.resource.data.guestUid == request.auth.uid)
        && request.resource.data.hostUid != request.resource.data.guestUid
        && request.resource.data.status == 'pending'
        && isIntInRange(request.resource.data.priceAgreed, 0, 100000)
        && isIntInRange(request.resource.data.feeArrearsMonths, 0, 12)
        && request.resource.data.createdMonth is int && request.resource.data.createdMonth >= 0;

      allow update: if isSignedIn()
        && (resource.data.hostUid == request.auth.uid || resource.data.guestUid == request.auth.uid)
        && request.resource.data.hostUid == resource.data.hostUid
        && request.resource.data.guestUid == resource.data.guestUid
        && request.resource.data.status in ['pending', 'active', 'suspended', 'dissolved']
        && isIntInRange(request.resource.data.priceAgreed, 0, 100000)
        && isIntInRange(request.resource.data.feeArrearsMonths, 0, 12);

      allow delete: if false;
    }

    // 10. Daily World Newsletter (create-once per world day)
    match /worldNewsletters/{day} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && request.resource.data.keys().hasOnly(['day', 'lines'])
        && request.resource.data.day is int && request.resource.data.day >= 1
        && day == string(request.resource.data.day)
        && request.resource.data.lines is list
        && request.resource.data.lines.size() >= 1
        && request.resource.data.lines.size() <= 20;
      allow update, delete: if false;
    }

    // Default deny for any undeclared collection
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
