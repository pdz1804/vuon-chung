# Game design

The rules a player meets, with the real numbers. Everything here comes from `src/sim` (`species.ts`, `growth.ts`,
`progression.ts`, `orders.ts`, `animals.ts`, `couple.ts`, `weather.ts`, `farm.ts`). Times are Vietnam time
(UTC+7); a "day" runs from midnight to midnight there.

A new garden starts with **50 coins**, **6 rau muống seeds** and **2 strawberry seeds**.

## Crops

| Crop       | Seed cost | Grows in (hydrated) | Regrows in | Yield | Sells for (1★) | XP  | Unlock  |
| ---------- | --------- | ------------------- | ---------- | ----- | -------------- | --- | ------- |
| Rau muống  | 5         | 4 h                 | no         | 1     | 12             | 2   | start   |
| Strawberry | 15        | 12 h                | 8 h        | 2     | 8 each         | 3   | start   |
| Sunflower  | 20        | 24 h                | no         | 1     | 45             | 5   | start   |
| Rose       | 30        | 48 h                | no         | 1     | 80             | 8   | Level 3 |

Hotbar keys `1` to `4` select them in that order. Seeds are bought at Cô Ba's stall or the chicken coop, one or
five at a time.

### Water and growth

- One watering (or one rain) keeps a plant hydrated for **24 hours**.
- A plant only grows while hydrated. Skipping a day delays a crop; it does not ruin it.
- Growth stages: seed, sprout, young, mature, ready.
- A plant left dry for more than 24 hours droops. Dryness after it is ready does not matter.
- Strawberries stay in the soil after harvest and regrow in 8 hours of hydrated time.
- Time keeps passing while you are offline.

### Quality stars

A harvest earns 1 to 3 stars:

| Star | How                                                                   |
| ---- | --------------------------------------------------------------------- |
| 1★   | Always.                                                               |
| +1★  | The plant was never dry for more than 24 hours before it was ready.   |
| +1★  | Both hands: both players cared for the plant on the same day (below). |

Price is multiplied by 1.0, 1.25 and 1.5 for 1, 2 and 3 stars (rounded). XP from a harvest is the crop's XP
multiplied by the stars.

## Both hands

Planting, watering, or tending a plant that needs nothing all count as caring for it. If both players care for
the same plant on the same Vietnam day, it earns the bonus star at harvest. A sparkle over a plant means your
partner already cared for it today, so tending it completes the pair. This needs two players in the garden.

## Rain

Rain is decided by the date, so both players always see the same weather:

- Chance of a rainy day: **35%** from May to November (rainy season), **12%** the rest of the year.
- The shower is visible from **06:00 to 09:00**.
- At 06:00 rain waters every crop already planted. A crop planted during the shower is watered at planting.

## Shipping bin and the shop

- **Ship** moves everything in your bag into the bin. The bin pays out at the **next midnight** (Vietnam time)
  at the 1★/2★/3★ price. Paying out is idempotent: it cannot pay twice.
- The **shop** (stall or coop) sells seeds and chicks. Locked items show the level that opens them.

## Garden Heart (levels)

The garden has one shared level, filled by XP from harvests, orders, eggs and memories.

| Level | Total XP | Unlocks                  |
| ----- | -------- | ------------------------ |
| 1     | 0        | the basics               |
| 2     | 100      | village orders, chickens |
| 3     | 300      | roses                    |
| 4     | 650      | (nothing yet)            |
| 5     | 1100     | (nothing yet)            |
| 6     | 1700     | (nothing yet)            |
| 7     | 2500     | (nothing yet)            |
| 8     | 3500     | (nothing yet)            |
| 9     | 4800     | (nothing yet)            |
| 10    | 6500     | (nothing yet)            |

Only implemented features are listed as unlocks; levels 4 to 10 are reserved for upcoming content.

## Village orders (Level 2)

The board by the path shows **three orders a day**, the same for both players, chosen from the date.

- Each asks for a crop (any quality) in a quantity of 1 to 3, or 1 to 6 for cheap crops (1★ price under 20:
  rau muống and strawberry).
- Reward: **1.5x** the 1★ price times the quantity in coins, and **10 + 2 per item** XP. Items are taken from
  your bag, lowest quality first.
- Orders only ask for crops you have unlocked, and the pool is frozen for the day once the first order is
  filled.

### Duo order

With two players in the garden the board also shows one **duo order** per day (marked with the both-hands
sign): a crop and a quantity of 2 to 4 that **each** partner delivers from their own bag. When both have
delivered, the garden receives a shared reward of **4x** the 1★ price times the quantity in coins, plus **40
XP**.

## Chickens (Level 2)

| Item             | Value                                               |
| ---------------- | --------------------------------------------------- |
| Price of a chick | 300 coins                                           |
| Coop capacity    | 4 chickens                                          |
| Feeder           | 3 coins per chicken, one fill covers the whole day  |
| Egg              | 30 coins at 1★, 2 XP times the stars when collected |
| Hearts           | 0 to 10                                             |

- **Feed** by using the feeder next to the coop. Fill it once a day; eggs are only available on a day the
  feeder is full.
- **Pet** a chicken once per person per day: +1 heart, or +2 if your partner petted it that day too.
- **Egg**: one per chicken per day, once the feeder is full. Using a chicken pets it first, then collects its
  egg on the next use. A chick bought after today's feeding lays from tomorrow.
- **Egg quality**: 1★, +1★ at 5 hearts, +1★ at 9 hearts.
- **Neglect**: after 3 days without food, hearts drop by one for each further day (never below 0). Filling the
  feeder resets it.

## The couple layer

| Feature             | Rules                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Mailbox             | Letters up to 500 characters; the newest 60 are kept; a heart floats over the box when one is unread.                        |
| Memory Tree         | A dated memory with a title up to 80 characters, +15 XP each, up to 400 memories. The tree grows at 1, 3, 6 and 10 memories. |
| Activity feed       | Harvests, shipping, orders, purchases, letters, memories, payouts and both-hands care are logged (last 50).                  |
| While you were away | On opening the game you see what your partner did since this device last saw the garden.                                     |
| Emotes              | Four: heart, wave, sprout and laughing. Shown as a bubble over the avatar for a few seconds.                                 |
| Walking together    | Walking side by side with your partner (within 24 px, both moving) makes you 25% faster.                                     |

## Controls

See the [README](../README.md#how-to-play) for keyboard and touch controls.
