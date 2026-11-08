# Fishers of Men

> &ldquo;Follow me, and I will make you fishers of men.&rdquo; &mdash; Matthew 4:19

Row out onto the Sea of Galilee, drop your net into the shoals and haul it back
aboard before the morning is gone. A full net is heavy and driftwood tears holes, so
every cast is a choice: one more fish, or get this catch home?

Open `index.html` in any browser &mdash; no build step and no server needed.

## How to play

1. Row the boat along the surface with the arrow keys &mdash; or drag it with the
   mouse or a finger.
2. Press `Space` to cast the net. It sinks steadily, and the arrow keys now steer the
   net instead of the boat.
3. Swim the net through a shoal to scoop fish up. The net holds only so many &mdash;
   when it is full it turns for home by itself, as it does at the sea floor.
4. Press `Space` again to haul early. **Fish only score once the net reaches the
   boat**, and a loaded net rises slowly.
5. Land the level's quota of fish before the clock runs out to sail on to the next
   morning's fishing. The clock does not wait for a net still in the water, so leave
   time for the last haul.

### Controls

| Key | Action |
|---|---|
| &larr; &rarr; (or A / D) | row the boat; steer the net once it is down |
| `Space` | cast the net; press again to haul it in |
| `P` | pause / resume |
| `R` | restart the level |
| mouse / touch | drag to row or steer, tap the water to cast and to haul |

### The catch

| Fish | Depth | Points |
|---|---|---|
| Sardine | shallow | 10 |
| Bream | middle | 25 |
| Tilapia | deep | 50 |

Landing several fish in one haul pays a bonus of 10 points per extra fish, so a
patient net beats a hurried one &mdash; as long as you get it home.

### Watch out for

**Driftwood.** Tangled wood and weed drift through the middle depths. Touching one
tears the net and a fish darts free; the tear mends after a moment, so a single snag
can never empty a full net at a stroke. An empty net slips past unharmed.

## Levels

| # | Morning | Quota | Net | Time |
|---|---|---|---|---|
| 1 | Launch Out into the Deep | 8 | 4 | 1:30 |
| 2 | Cast on the Right Side | 12 | 5 | 1:30 |
| 3 | Shoals of Galilee | 14 | 6 | 1:30 |
| 4 | Mending the Nets | 17 | 7 | 1:30 |
| 5 | A Hundred and Fifty-Three | 18 | 8 | 1:30 |

Each level gives you more net to fill but faster fish and more driftwood to thread,
so the quota stays reachable while a high score does not.

The level names follow the Gospel fishing accounts &mdash; the call by the lakeside
(Matthew 4:18&ndash;22), the nets that began to break (Luke 5:4&ndash;7) and the
hundred and fifty-three large fish of John 21:11.

Your best score is kept in your browser between visits.

## Tests

From the repository root:

```powershell
npx playwright test FishersOfMen/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
