// =========================================================================
// Scribe's Crossword
//
// A crossword whose every answer comes from the Bible, generated at run time
// from a bank of answer-and-clue pairs in the interlocking "criss-cross" style
// (Ezra 7:10 — the scribe who set his heart to study the Law).
//
// One plain script, like the other puzzle games here, so the rules, the grid
// and the player's letters all stay reachable from the Playwright suite as
// ordinary globals.
// =========================================================================

// ---------------------------------------------------------------- constants
const PAD = 10;              // breathing room between the grid and the canvas edge
const BUILD_ATTEMPTS = 60;   // fresh shuffles tried before keeping the best scroll

const LEVELS = [
    { name: 'Short scroll', cols: 9, rows: 9, maxLen: 7, target: 10, minWords: 8 },
    { name: 'Long scroll', cols: 11, rows: 11, maxLen: 8, target: 14, minWords: 11 },
    { name: 'Great scroll', cols: 13, rows: 13, maxLen: 9, target: 18, minWords: 14 },
];

// Every answer and clue comes from the Bible. Answers are letters only, 3-9
// long, so a cell always holds exactly one capital letter.
const WORD_BANK = [
    // --- three ---
    ['ARK', 'Noah built one of gopher wood (Genesis 6)'],
    ['LAW', 'What was written on the two tablets of stone'],
    ['SON', 'The prodigal who came home to his father'],
    ['FIG', 'Tree whose leaves clothed Adam and Eve'],
    ['NET', "Peter let it down at Jesus' word for a catch"],
    ['OIL', 'What the wise maidens kept for their lamps'],
    ['RAM', "Caught in a thicket in Isaac's place"],
    ['JOY', 'Fruit of the Spirit that follows love'],
    ['WAY', '"I am the ___, the truth, and the life"'],
    ['EVE', 'The first woman, the mother of all living'],
    ['PIT', "Joseph's brothers threw him into one at Dothan"],
    ['ROD', "Aaron's budded before the whole congregation"],
    ['SEA', 'Jesus stilled the storm on the ___ of Galilee'],
    ['DEN', "Daniel spent a night in the lions' ___"],
    // --- four ---
    ['NOAH', 'He and his household rode out the flood'],
    ['EDEN', 'The garden where the first man was placed'],
    ['RUTH', 'Moabite who gleaned in the fields of Boaz'],
    ['BOAZ', 'Kinsman-redeemer who married Ruth'],
    ['MARY', 'Mother of Jesus'],
    ['PAUL', 'Apostle to the Gentiles, once called Saul'],
    ['AMEN', '"So be it", said at the end of a prayer'],
    ['DOVE', 'It came back to the ark with an olive leaf'],
    ['LAMB', '"Behold the ___ of God" (John 1:29)'],
    ['SALT', '"You are the ___ of the earth"'],
    ['SEED', 'The sower went out to scatter it'],
    ['WELL', "Jacob's, where Jesus met a Samaritan woman"],
    ['ROCK', 'Moses struck it at Horeb and water came out'],
    ['TOMB', 'Garden grave found empty on the third day'],
    ['STAR', 'It led the wise men toward Bethlehem'],
    ['MAGI', 'Wise men who came from the east'],
    ['PALM', 'Branch waved on the road into Jerusalem'],
    ['COAT', "Joseph's was of many colours"],
    ['MILK', 'Canaan flowed with it and with honey'],
    ['LION', "Judah's emblem; Daniel's night-time company"],
    ['LEVI', 'The priestly tribe of Israel'],
    ['SAUL', "Israel's first king, anointed by Samuel"],
    ['EZRA', 'Scribe who read the Law aloud to the people'],
    ['GATE', "Nehemiah's men rebuilt the Sheep ___"],
    ['WALL', 'What Nehemiah finished in fifty-two days'],
    ['HOPE', 'With faith and love, one of the three that remain'],
    ['LOVE', 'The greatest of faith, hope and this'],
    ['TREE', 'Of life, in the middle of the garden'],
    ['LAMP', '"Your word is a ___ unto my feet"'],
    ['ACTS', "Book of the apostles' doings"],
    ['FISH', 'Two of these and five loaves fed the crowd'],
    ['BOAT', 'Jesus slept in one through a squall'],
    ['ADAM', 'The first man, formed from the dust'],
    ['ZION', 'Another name for Jerusalem, the city of God'],
    ['ESAU', 'Twin who traded his birthright for a meal'],
    ['LEAH', "Jacob's first wife, Rachel's sister"],
    ['ROME', 'City where Paul was held under guard'],
    ['HARP', 'David played it to quiet King Saul'],
    ['GOLD', 'Gift of the wise men, with frankincense and myrrh'],
    ['DUST', 'Man was formed of it, and returns to it'],
    ['MITE', "The widow's small coin, all that she had"],
    ['WIND', 'At Pentecost it sounded like a rushing mighty one'],
    ['ABEL', 'Keeper of sheep, the second son of Adam'],
    ['JOHN', 'Baptist who cried in the wilderness'],
    ['LUKE', 'Beloved physician who wrote a Gospel'],
    ['MARK', 'Gospel writer who travelled with Barnabas'],
    ['ALMS', 'Giving to the poor, to be done in secret'],
    ['VINE', '"I am the ___, you are the branches"'],
    // --- five ---
    ['MOSES', 'He led Israel out of Egypt'],
    ['AARON', "Moses' brother, Israel's first high priest"],
    ['SINAI', 'Mountain where the Law was given'],
    ['MANNA', 'Bread from heaven in the wilderness'],
    ['DAVID', 'Shepherd boy who felled the giant of Gath'],
    ['NAOMI', "Ruth's mother-in-law, who went home to Bethlehem"],
    ['JONAH', 'Prophet swallowed by a great fish'],
    ['PSALM', "A song from Israel's hymn book"],
    ['PETER', 'Fisherman whom Jesus named Cephas'],
    ['SILAS', "Paul's companion in the Philippian jail"],
    ['GRACE', "God's unearned favour toward us"],
    ['FAITH', '"The substance of things hoped for"'],
    ['PEACE', 'Fruit of the Spirit that follows joy'],
    ['MERCY', 'What the merciful shall obtain, says the Beatitude'],
    ['ALTAR', 'Where the offerings were laid and burned'],
    ['ISAAC', 'Son of promise, laid on the altar at Moriah'],
    ['JACOB', 'He wrestled till daybreak and was renamed Israel'],
    ['SARAH', 'She laughed, and bore a son in her old age'],
    ['JUDAH', 'Tribe of David and of the Christ'],
    ['BIBLE', 'The book of books'],
    ['BREAD', '"Give us this day our daily ___"'],
    ['LIGHT', '"You are the ___ of the world"'],
    ['PEARL', 'The merchant sold all he had for one of these'],
    ['ANGEL', 'Messenger whose first word is often "fear not"'],
    ['CROWN', '"___ of life" promised to the faithful'],
    ['FIELD', 'The treasure of the parable lay hidden in one'],
    ['HOUSE', 'The wise man built his upon the rock'],
    ['SLING', "David's weapon against the giant"],
    ['STONE', 'Rolled away from the door of the tomb'],
    ['STAFF', "A shepherd's; Moses carried one to Egypt"],
    ['SWORD', '"The ___ of the Spirit, which is the word of God"'],
    ['TRUTH', '"I am the way, the ___, and the life"'],
    ['TITHE', 'A tenth part given back to the Lord'],
    ['TOWER', "Babel's, built to reach the heavens"],
    ['FLOOD', 'Forty days of rain brought it on the earth'],
    ['JOPPA', 'Port where Jonah took ship for Tarshish'],
    ['LYDIA', 'Seller of purple who believed at Philippi'],
    ['SHEEP', 'Ninety-nine were left to find the one that strayed'],
    ['GLORY', '"The heavens declare the ___ of God"'],
    ['HEART', '"Create in me a clean ___, O God"'],
    ['ENOCH', 'He walked with God and was taken away'],
    ['SOWER', "The parable's man who went out to plant"],
    ['CAMEL', 'It cannot go through the eye of a needle'],
    ['EGYPT', "Land of Israel's bondage under Pharaoh"],
    ['HONEY', 'The Baptist ate locusts and wild ___'],
    ['HEROD', "King who was troubled by the wise men's news"],
    // --- six ---
    ['CANAAN', "The land promised to Abraham's children"],
    ['JORDAN', 'River Israel crossed to enter the promised land'],
    ['TEMPLE', 'Solomon built the first one in Jerusalem'],
    ['ESTHER', 'Queen who stood before the king for her people'],
    ['ELIJAH', 'Prophet taken up in a whirlwind'],
    ['ELISHA', "Prophet who received Elijah's mantle"],
    ['DANIEL', 'He was kept safe among the lions'],
    ['ISAIAH', 'Prophet who saw the Lord high and lifted up'],
    ['JOSEPH', 'The dreamer sold into Egypt by his brothers'],
    ['SAMSON', 'Strong man of the tribe of Dan'],
    ['WISDOM', 'What Solomon asked for instead of riches'],
    ['SCROLL', 'What Ezra read from before the people'],
    ['SCRIBE', "Ezra's office: a copier and teacher of the Law"],
    ['PRIEST', 'One who served at the altar for the people'],
    ['GOSPEL', 'The good news of Jesus Christ'],
    ['CHURCH', 'The people of Christ, gathered together'],
    ['HEAVEN', '"Our Father, who art in ___"'],
    ['ARMOUR', '"Put on the whole ___ of God"'],
    ['SHIELD', '"___ of faith" that quenches the fiery darts'],
    ['HELMET', '"___ of salvation" in the armour of God'],
    ['RACHEL', "Jacob's beloved wife, Joseph's mother"],
    ['MARTHA', 'Sister who was busy with much serving'],
    ['PILATE', 'Governor who washed his hands of the matter'],
    ['PHILIP', 'He preached to the Ethiopian on the desert road'],
    ['TALENT', 'Weight of silver entrusted to the servants'],
    ['LOCUST', 'Eighth plague upon the land of Egypt'],
    ['PLAGUE', 'One of the ten that fell upon Egypt'],
    ['EXODUS', 'Book of the going out from Egypt'],
    ['ROMANS', "Paul's letter on righteousness by faith"],
    ['PRAYER', 'What Jesus taught his disciples on the mount'],
    ['FATHER', 'He ran to meet his prodigal son'],
    ['DONKEY', 'Beast that carried Jesus into Jerusalem'],
    ['CHERUB', 'Winged guardian set at the gate of Eden'],
    ['SPIRIT', 'The Comforter sent at Pentecost'],
    ['ATHENS', "Where Paul preached on Mars' Hill"],
    ['TARSUS', "Paul's home city in Cilicia"],
    ['BETHEL', 'Where Jacob dreamed of a ladder to heaven'],
    ['JOSHUA', 'He led Israel over the Jordan into Canaan'],
    ['GOSHEN', 'Where Israel settled in the land of Egypt'],
    ['SAMUEL', 'Boy who answered "Speak, your servant hears"'],
    // --- seven ---
    ['JERICHO', 'City whose walls fell at the trumpet blast'],
    ['NINEVEH', "City that repented at Jonah's preaching"],
    ['BABYLON', "City of Israel's seventy-year exile"],
    ['GOLIATH', 'Philistine champion of Gath'],
    ['ABRAHAM', 'Father of many nations, the friend of God'],
    ['SOLOMON', 'King who built the temple and wrote proverbs'],
    ['TIMOTHY', 'Young pastor Paul called his son in the faith'],
    ['GENESIS', 'The first book of the Bible'],
    ['PROVERB', "A short saying of Solomon's wisdom"],
    ['GALILEE', 'Sea Jesus walked upon in the fourth watch'],
    ['SAMARIA', 'Region of the good neighbour in the parable'],
    ['SABBATH', 'The seventh day, kept for rest'],
    ['TRUMPET', 'Horn blown seven times around Jericho'],
    ['MUSTARD', 'Smallest of seeds, likened to the kingdom'],
    ['APOSTLE', 'One of the twelve sent out by Christ'],
    ['SPARROW', 'Not one falls without the Father knowing'],
    ['RAINBOW', 'Sign of the covenant after the flood'],
    ['STEPHEN', 'First of the church to die for the faith'],
    ['LAZARUS', 'Brother of Mary and Martha, called from the tomb'],
    ['CORINTH', 'Church Paul wrote to about love'],
    ['EPHESUS', 'Church told to put on the armour of God'],
    ['TABITHA', 'Also called Dorcas, raised up at Joppa'],
    ['PHARAOH', 'King of Egypt whose heart was hardened'],
    ['GENTILE', 'One outside Israel, brought near by Christ'],
    ['HOSANNA', '"___ to the Son of David!"'],
    // --- eight and nine ---
    ['DISCIPLE', 'A follower and learner of the Master'],
    ['NAZARETH', 'Town where Jesus grew up'],
    ['SHEPHERD', '"The Lord is my ___"'],
    ['NEHEMIAH', 'He rebuilt the walls of Jerusalem'],
    ['PASSOVER', 'Feast of the lamb and unleavened bread'],
    ['JEREMIAH', "Weeping prophet of Judah's last days"],
    ['JONATHAN', "Saul's son, who loved David as his own soul"],
    ['JERUSALEM', 'City of David, where the temple stood'],
    ['BETHLEHEM', 'City where the Christ was born'],
    ['PENTECOST', 'Day the Spirit came with tongues of fire'],
];

// ------------------------------------------------------------------- state
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let levelIndex = 0;
let cellSize = 0;
let ORIGIN_X = 0;
let ORIGIN_Y = 0;

let puzzle = null;      // { cols, rows, grid, entries, numbers, seed, level }
let entries = [];       // alias of puzzle.entries, for convenience
let letters = [];       // the player's grid, '' where empty
let selection = null;   // { r, c, dir } or null
let endStop = false;    // the cursor sits on a filled last cell of an entry
let wrong = new Set();  // cells marked by Check, as 'r,c'
let wrongTimer = null;
let hintsUsed = 0;
let solved = false;
let seedCounter = 1;

// ------------------------------------------------------------- pure helpers
// Small deterministic PRNG (mulberry32), so a seed always builds the same scroll.
function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function rand() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled(list, rand) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function step(dir) {
    return dir === 'down' ? { dr: 1, dc: 0 } : { dr: 0, dc: 1 };
}

// ------------------------------------------------------------- the generator
// A placement is legal when the word stays on the grid, agrees with every
// letter it covers, touches at least one of them, is not butted up against
// another word on its own axis, does not run along a word already going the
// same way, and leaves the cells beside its new letters empty. Those rules are
// what keep stray two-letter runs out of the finished grid.
function checkPlacement(grid, dirs, word, r, c, dir, cols, rows) {
    const { dr, dc } = step(dir);
    const len = word.length;
    if (r + dr * (len - 1) >= rows || c + dc * (len - 1) >= cols) return null;

    const br = r - dr;
    const bc = c - dc;
    if (br >= 0 && bc >= 0 && grid[br][bc] !== null) return null;
    const ar = r + dr * len;
    const ac = c + dc * len;
    if (ar < rows && ac < cols && grid[ar][ac] !== null) return null;

    let crossings = 0;
    for (let i = 0; i < len; i++) {
        const rr = r + dr * i;
        const cc = c + dc * i;
        const here = grid[rr][cc];
        if (here === null) {
            // Nothing may sit beside a brand new letter, or the two would read
            // as a word nobody clued.
            for (const s of [-1, 1]) {
                const nr = rr + dc * s;
                const nc = cc + dr * s;
                if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
                if (grid[nr][nc] !== null) return null;
            }
        } else {
            if (here !== word[i]) return null;
            if (dirs[rr][cc][dir]) return null;   // already a word this way
            crossings++;
        }
    }
    return crossings > 0 ? { crossings } : null;
}

function layWord(grid, dirs, word, r, c, dir) {
    const { dr, dc } = step(dir);
    for (let i = 0; i < word.length; i++) {
        const rr = r + dr * i;
        const cc = c + dc * i;
        grid[rr][cc] = word[i];
        dirs[rr][cc][dir] = true;
    }
}

// Lays words until the level's target is met or nothing else fits.
function attemptBuild(cfg, rand) {
    const { cols, rows, maxLen, target } = cfg;
    const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    const dirs = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ({ across: false, down: false }))
    );

    const limit = Math.min(maxLen, cols);
    const pool = shuffled(WORD_BANK.filter(([a]) => a.length <= limit), rand);
    if (!pool.length) return { grid, placed: [] };

    // A long word down the middle makes a spine for everything else to cross.
    const longest = pool.slice().sort((a, b) => b[0].length - a[0].length);
    const spine = longest[Math.floor(rand() * Math.min(5, longest.length))];
    const spineRow = Math.floor(rows / 2);
    const spineCol = Math.floor((cols - spine[0].length) / 2);
    layWord(grid, dirs, spine[0], spineRow, spineCol, 'across');

    const placed = [{
        answer: spine[0], clue: spine[1], r: spineRow, c: spineCol,
        dir: 'across', len: spine[0].length,
    }];
    const used = new Set([spine[0]]);

    let progress = true;
    while (placed.length < target && progress) {
        progress = false;
        for (const [answer, clueText] of pool) {
            if (placed.length >= target) break;
            if (used.has(answer)) continue;

            const spots = [];
            for (const dir of ['across', 'down']) {
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const fit = checkPlacement(grid, dirs, answer, r, c, dir, cols, rows);
                        if (fit) spots.push({ r, c, dir, crossings: fit.crossings });
                    }
                }
            }
            if (!spots.length) continue;

            const best = Math.max(...spots.map((s) => s.crossings));
            const top = spots.filter((s) => s.crossings === best);
            const spot = top[Math.floor(rand() * top.length)];
            layWord(grid, dirs, answer, spot.r, spot.c, spot.dir);
            placed.push({
                answer, clue: clueText, r: spot.r, c: spot.c,
                dir: spot.dir, len: answer.length,
            });
            used.add(answer);
            progress = true;
        }
    }
    return { grid, placed };
}

// Every maximal run of two or more letters on the grid.
function gridRuns(grid, cols, rows) {
    const runs = [];
    for (let r = 0; r < rows; r++) {
        let c = 0;
        while (c < cols) {
            if (grid[r][c] === null) { c++; continue; }
            let end = c;
            while (end + 1 < cols && grid[r][end + 1] !== null) end++;
            if (end > c) runs.push({ dir: 'across', r, c, len: end - c + 1 });
            c = end + 1;
        }
    }
    for (let c = 0; c < cols; c++) {
        let r = 0;
        while (r < rows) {
            if (grid[r][c] === null) { r++; continue; }
            let end = r;
            while (end + 1 < rows && grid[end + 1][c] !== null) end++;
            if (end > r) runs.push({ dir: 'down', r, c, len: end - r + 1 });
            r = end + 1;
        }
    }
    return runs;
}

// A safety net: the words laid down must be exactly the runs on the grid.
function runsMatch(grid, placed, cols, rows) {
    const key = (x) => `${x.dir}:${x.r}:${x.c}:${x.len}`;
    const runs = new Set(gridRuns(grid, cols, rows).map(key));
    const words = new Set(placed.map(key));
    if (runs.size !== words.size) return false;
    for (const k of words) if (!runs.has(k)) return false;
    return true;
}

// Slides the finished words so the block of parchment sits in the middle of
// the grid, which looks deliberate rather than wherever the growth wandered.
function centreWords(grid, placed, cols, rows) {
    let top = rows, bottom = -1, left = cols, right = -1;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] === null) continue;
            if (r < top) top = r;
            if (r > bottom) bottom = r;
            if (c < left) left = c;
            if (c > right) right = c;
        }
    }
    if (bottom < 0) return { grid, placed };
    const dr = Math.floor((rows - 1 - (bottom - top)) / 2) - top;
    const dc = Math.floor((cols - 1 - (right - left)) / 2) - left;
    if (!dr && !dc) return { grid, placed };

    const moved = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] !== null) moved[r + dr][c + dc] = grid[r][c];
        }
    }
    return {
        grid: moved,
        placed: placed.map((w) => ({ ...w, r: w.r + dr, c: w.c + dc })),
    };
}

// Numbers the entries the way a newspaper does: reading order, one number per
// starting cell, shared when an across and a down entry start together.
function numberEntries(grid, placed, cols, rows) {
    const numbers = Array.from({ length: rows }, () => Array(cols).fill(0));
    let next = 1;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] === null) continue;
            const startsAcross = (c === 0 || grid[r][c - 1] === null)
                && c + 1 < cols && grid[r][c + 1] !== null;
            const startsDown = (r === 0 || grid[r - 1][c] === null)
                && r + 1 < rows && grid[r + 1][c] !== null;
            if (startsAcross || startsDown) numbers[r][c] = next++;
        }
    }
    const list = placed.map((w) => {
        const { dr, dc } = step(w.dir);
        const cells = Array.from({ length: w.len }, (_, i) => ({
            r: w.r + dr * i, c: w.c + dc * i,
        }));
        return { ...w, num: numbers[w.r][w.c], cells };
    });
    list.sort((a, b) => a.num - b.num || (a.dir === 'across' ? -1 : 1));
    return { numbers, list };
}

// Builds a whole scroll for a level. The same seed always gives the same one.
function buildPuzzle(level, seed) {
    const cfg = LEVELS[level];
    let best = null;
    for (let attempt = 0; attempt < BUILD_ATTEMPTS; attempt++) {
        const rand = makeRng(seed * 7919 + attempt * 104729 + 1);
        const built = attemptBuild(cfg, rand);
        if (!runsMatch(built.grid, built.placed, cfg.cols, cfg.rows)) continue;
        if (!best || built.placed.length > best.placed.length) best = built;
        if (best.placed.length >= cfg.target) break;
    }
    const tidy = centreWords(best.grid, best.placed, cfg.cols, cfg.rows);
    const { numbers, list } = numberEntries(tidy.grid, tidy.placed, cfg.cols, cfg.rows);
    return {
        cols: cfg.cols, rows: cfg.rows, grid: tidy.grid,
        entries: list, numbers, seed, level,
    };
}

// ----------------------------------------------------------------- geometry
function layout() {
    cellSize = Math.floor((canvas.width - PAD * 2) / puzzle.cols);
    ORIGIN_X = Math.round((canvas.width - cellSize * puzzle.cols) / 2);
    ORIGIN_Y = Math.round((canvas.height - cellSize * puzzle.rows) / 2);
}

function cellCentre(r, c) {
    return {
        x: ORIGIN_X + c * cellSize + cellSize / 2,
        y: ORIGIN_Y + r * cellSize + cellSize / 2,
    };
}

function cellFromPoint(x, y) {
    const c = Math.floor((x - ORIGIN_X) / cellSize);
    const r = Math.floor((y - ORIGIN_Y) / cellSize);
    if (r < 0 || c < 0 || r >= puzzle.rows || c >= puzzle.cols) return null;
    return { r, c };
}

// --------------------------------------------------------------- entry logic
function entryAt(r, c, dir) {
    return puzzle.entries.find(
        (e) => e.dir === dir && e.cells.some((cell) => cell.r === r && cell.c === c)
    ) || null;
}

function currentEntry() {
    if (!selection) return null;
    return entryAt(selection.r, selection.c, selection.dir);
}

function entryComplete(entry) {
    return entry.cells.every((cell) => letters[cell.r][cell.c] === puzzle.grid[cell.r][cell.c]);
}

function letterCells() {
    const out = [];
    for (let r = 0; r < puzzle.rows; r++) {
        for (let c = 0; c < puzzle.cols; c++) {
            if (puzzle.grid[r][c] !== null) out.push({ r, c });
        }
    }
    return out;
}

// ------------------------------------------------------------------ building
function newPuzzle(seed) {
    const previous = puzzle ? JSON.stringify(puzzle.entries) : null;
    let next = null;
    for (let tries = 0; tries < 10; tries++) {
        const useSeed = seed !== undefined ? seed : seedCounter++;
        next = buildPuzzle(levelIndex, useSeed);
        if (seed !== undefined || JSON.stringify(next.entries) !== previous) break;
    }
    puzzle = next;
    entries = puzzle.entries;
    letters = Array.from({ length: puzzle.rows }, () => Array(puzzle.cols).fill(''));
    wrong = new Set();
    hintsUsed = 0;
    solved = false;
    endStop = false;
    selection = null;
    layout();

    const first = puzzle.entries[0];
    if (first) selection = { r: first.r, c: first.c, dir: first.dir };

    document.getElementById('overlay').classList.remove('visible');
    renderClues();
    setStatus('Fill the scroll from the clues — click a cell or a clue to begin.', '');
    updateHud();
    draw();
}

function setLevel(index) {
    levelIndex = index;
    document.querySelectorAll('.level-btn').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.level) === index);
    });
    document.getElementById('level-label').textContent = LEVELS[index].name;
    newPuzzle();
}

function nextLevel() {
    setLevel((levelIndex + 1) % LEVELS.length);
}

function resetBoard() {
    letters = Array.from({ length: puzzle.rows }, () => Array(puzzle.cols).fill(''));
    wrong = new Set();
    hintsUsed = 0;
    solved = false;
    endStop = false;
    document.getElementById('overlay').classList.remove('visible');
    setStatus('The scroll is clean again.', '');
    updateHud();
    renderClues();
    draw();
}

// ------------------------------------------------------------------- display
function setStatus(text, kind) {
    const el = document.getElementById('status');
    el.textContent = text;
    el.className = kind || '';
}

function clueLabel(entry) {
    const dir = entry.dir === 'across' ? 'Across' : 'Down';
    return `${entry.num} ${dir}: ${entry.clue}`;
}

function updateHud() {
    const done = puzzle.entries.filter(entryComplete).length;
    document.getElementById('words').textContent = `${done} / ${puzzle.entries.length}`;
    const cells = letterCells();
    const filled = cells.filter((cell) => letters[cell.r][cell.c] !== '').length;
    document.getElementById('filled').textContent = `${filled} / ${cells.length}`;
    document.getElementById('hints').textContent = String(hintsUsed);

    const entry = currentEntry();
    document.getElementById('current-clue').textContent = entry
        ? clueLabel(entry)
        : 'Click a cell or a clue to start writing.';
    markClues();
}

function renderClues() {
    for (const dir of ['across', 'down']) {
        const list = document.getElementById(`${dir}-list`);
        list.innerHTML = puzzle.entries
            .filter((e) => e.dir === dir)
            .map((e) => `<button type="button" class="clue" data-dir="${dir}" data-num="${e.num}">`
                + `<span class="num">${e.num}</span><span class="text">${e.clue}</span></button>`)
            .join('');
    }
    markClues();
}

function markClues() {
    const entry = currentEntry();
    document.querySelectorAll('.clue').forEach((btn) => {
        const found = puzzle.entries.find(
            (e) => e.dir === btn.dataset.dir && e.num === Number(btn.dataset.num)
        );
        if (!found) return;
        btn.classList.toggle('active', entry === found);
        btn.classList.toggle('done', entryComplete(found));
    });
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const entry = currentEntry();
    const inEntry = new Set(entry ? entry.cells.map((cell) => `${cell.r},${cell.c}`) : []);
    const numberFont = `${Math.max(8, Math.round(cellSize * 0.26))}px 'Segoe UI', system-ui, sans-serif`;
    const letterFont = `600 ${Math.round(cellSize * 0.58)}px 'Segoe UI', system-ui, sans-serif`;

    for (let r = 0; r < puzzle.rows; r++) {
        for (let c = 0; c < puzzle.cols; c++) {
            if (puzzle.grid[r][c] === null) continue;
            const x = ORIGIN_X + c * cellSize;
            const y = ORIGIN_Y + r * cellSize;
            const key = `${r},${c}`;
            const isSelected = selection && selection.r === r && selection.c === c;

            ctx.fillStyle = isSelected ? '#ffe9a8' : inEntry.has(key) ? '#f3e2b4' : '#e7d6ac';
            ctx.fillRect(x, y, cellSize, cellSize);
            ctx.strokeStyle = '#8a6f33';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);

            if (puzzle.numbers[r][c]) {
                ctx.fillStyle = '#7d6531';
                ctx.font = numberFont;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(String(puzzle.numbers[r][c]), x + 2, y + 2);
            }

            const ch = letters[r][c];
            if (ch) {
                ctx.fillStyle = wrong.has(key) ? '#bb3322' : solved ? '#2f5d20' : '#2a2112';
                ctx.font = letterFont;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(ch, x + cellSize / 2, y + cellSize / 2 + cellSize * 0.04);
            }

            if (isSelected) {
                ctx.strokeStyle = '#e8b74a';
                ctx.lineWidth = 3;
                ctx.strokeRect(x + 1.5, y + 1.5, cellSize - 3, cellSize - 3);
            }
        }
    }
}

// ------------------------------------------------------------------- playing
function select(r, c, dir) {
    if (puzzle.grid[r][c] === null) return;
    const wanted = dir || (selection ? selection.dir : 'across');
    const useDir = entryAt(r, c, wanted) ? wanted
        : entryAt(r, c, 'across') ? 'across'
            : entryAt(r, c, 'down') ? 'down' : null;
    if (!useDir) return;
    selection = { r, c, dir: useDir };
    endStop = false;
    updateHud();
    draw();
}

function turnDirection() {
    if (!selection) return;
    const other = selection.dir === 'across' ? 'down' : 'across';
    if (!entryAt(selection.r, selection.c, other)) return;
    selection.dir = other;
    endStop = false;
    updateHud();
    draw();
}

function writeLetter(ch) {
    if (solved || !selection || endStop) return;
    const entry = currentEntry();
    if (!entry) return;
    letters[selection.r][selection.c] = ch;
    wrong.delete(`${selection.r},${selection.c}`);

    const index = entry.cells.findIndex((cell) => cell.r === selection.r && cell.c === selection.c);
    if (index < entry.len - 1) {
        const nextCell = entry.cells[index + 1];
        selection = { r: nextCell.r, c: nextCell.c, dir: entry.dir };
    } else {
        endStop = true;
    }
    afterChange();
}

function rubOut() {
    if (solved || !selection) return;
    const entry = currentEntry();
    if (letters[selection.r][selection.c]) {
        letters[selection.r][selection.c] = '';
        wrong.delete(`${selection.r},${selection.c}`);
        endStop = false;
    } else if (entry) {
        const index = entry.cells.findIndex((cell) => cell.r === selection.r && cell.c === selection.c);
        if (index > 0) {
            const prev = entry.cells[index - 1];
            selection = { r: prev.r, c: prev.c, dir: entry.dir };
            letters[prev.r][prev.c] = '';
            wrong.delete(`${prev.r},${prev.c}`);
        }
        endStop = false;
    }
    afterChange();
}

function move(dr, dc) {
    if (!selection) return;
    let r = selection.r + dr;
    let c = selection.c + dc;
    while (r >= 0 && c >= 0 && r < puzzle.rows && c < puzzle.cols) {
        if (puzzle.grid[r][c] !== null) {
            select(r, c, dr !== 0 ? 'down' : 'across');
            return;
        }
        r += dr;
        c += dc;
    }
}

function hopEntry(delta) {
    const list = puzzle.entries;
    if (!list.length) return;
    const entry = currentEntry();
    const at = entry ? list.indexOf(entry) : -1;
    const next = list[(at + delta + list.length * 2) % list.length];
    selection = { r: next.r, c: next.c, dir: next.dir };
    endStop = false;
    updateHud();
    draw();
}

function check() {
    if (solved) return;
    wrong = new Set();
    let filled = 0;
    for (const cell of letterCells()) {
        const written = letters[cell.r][cell.c];
        if (!written) continue;
        filled++;
        if (written !== puzzle.grid[cell.r][cell.c]) wrong.add(`${cell.r},${cell.c}`);
    }
    if (!filled) {
        setStatus('Nothing is written on the scroll yet.', '');
    } else if (wrong.size) {
        const n = wrong.size;
        setStatus(`${n} letter${n === 1 ? ' is' : 's are'} not right yet.`, 'bad');
    } else {
        setStatus('Every letter written so far is right — keep going.', 'good');
    }
    if (wrongTimer) clearTimeout(wrongTimer);
    wrongTimer = setTimeout(() => {
        wrong = new Set();
        draw();
    }, 3000);
    draw();
}

function revealLetter() {
    if (solved) return;
    if (!selection) {
        setStatus('Choose a cell first, then reveal its letter.', 'bad');
        return;
    }
    const { r, c } = selection;
    letters[r][c] = puzzle.grid[r][c];
    wrong.delete(`${r},${c}`);
    hintsUsed++;
    setStatus('A letter from the scribe.', '');
    afterChange();
}

function afterChange() {
    updateHud();
    if (!solved && letterCells().every((cell) => letters[cell.r][cell.c] === puzzle.grid[cell.r][cell.c])) {
        solved = true;
        wrong = new Set();
        const overlay = document.getElementById('overlay');
        document.getElementById('overlay-title').textContent = 'The scroll is complete!';
        document.getElementById('overlay-sub').textContent =
            `${puzzle.entries.length} words of Scripture written out`
            + `${hintsUsed ? ` with ${hintsUsed} revealed letter${hintsUsed === 1 ? '' : 's'}` : ' with no help at all'}.`;
        overlay.classList.add('visible');
        setStatus('Well copied, scribe.', 'good');
        updateHud();
    }
    draw();
}

// -------------------------------------------------------------------- input
canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);
    const cell = cellFromPoint(x, y);
    if (!cell || puzzle.grid[cell.r][cell.c] === null) return;
    if (selection && selection.r === cell.r && selection.c === cell.c) {
        turnDirection();
        return;
    }
    select(cell.r, cell.c);
});

document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;

    if (key === 'Tab') {
        event.preventDefault();
        hopEntry(event.shiftKey ? -1 : 1);
        return;
    }
    if (key === 'Escape') {
        selection = null;
        endStop = false;
        updateHud();
        draw();
        return;
    }
    if (key === ' ') {
        event.preventDefault();
        turnDirection();
        return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        if (key === 'ArrowUp') move(-1, 0);
        else if (key === 'ArrowDown') move(1, 0);
        else if (key === 'ArrowLeft') move(0, -1);
        else move(0, 1);
        return;
    }
    if (key === 'Backspace' || key === 'Delete') {
        event.preventDefault();
        rubOut();
        return;
    }
    if (/^[a-zA-Z]$/.test(key)) {
        writeLetter(key.toUpperCase());
    }
});

document.addEventListener('click', (event) => {
    const btn = event.target.closest('.clue');
    if (!btn) return;
    const entry = puzzle.entries.find(
        (e) => e.dir === btn.dataset.dir && e.num === Number(btn.dataset.num)
    );
    if (!entry) return;
    btn.blur();   // so Space and Enter go to the grid, not back to this button
    selection = { r: entry.r, c: entry.c, dir: entry.dir };
    endStop = false;
    updateHud();
    draw();
});

// The on-screen keyboard, so the scroll can be filled in on a tablet or phone
// where there is no keyboard to type on.
const KEY_ROWS = ['ABCDEFGHI', 'JKLMNOPQR', 'STUVWXYZ'];
(function buildKeyboard() {
    const board = document.getElementById('keyboard');
    board.innerHTML = KEY_ROWS.map((row, i) => {
        const keys = [...row].map(
            (ch) => `<button type="button" class="key" data-key="${ch}">${ch}</button>`
        );
        if (i === KEY_ROWS.length - 1) {
            keys.push('<button type="button" class="key wide" data-key="back" '
                + 'aria-label="Rub out">&#9003;</button>');
        }
        return `<div class="key-row">${keys.join('')}</div>`;
    }).join('');
    board.addEventListener('click', (event) => {
        const key = event.target.closest('.key');
        if (!key) return;
        key.blur();
        if (key.dataset.key === 'back') rubOut();
        else writeLetter(key.dataset.key);
    });
})();

document.getElementById('btn-check').addEventListener('click', check);
document.getElementById('btn-hint').addEventListener('click', revealLetter);
document.getElementById('btn-reset').addEventListener('click', resetBoard);
document.getElementById('btn-new').addEventListener('click', () => newPuzzle());
document.getElementById('btn-next').addEventListener('click', nextLevel);
document.querySelectorAll('.level-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        btn.blur();
        setLevel(Number(btn.dataset.level));
    });
});

setLevel(0);
