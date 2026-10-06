/**
 * The Shooting Star [Demo] — Bedrock Script API port (BP 1.26.51)
 * Original Java mod: dev.aek.shootingstardemo (Fabric, MC 1.21.11)
 *
 * Ported from the .class files (numbers below are the real constants read from the bytecode):
 *   star.StarSkill / star.StarEngine ........ skills, cooldown (1200t), evacuate / spare / ward rules
 *   star.ShootingStar ....................... SS-01 timeline (ARMED 5 · PRESS 7 · MARK 9 · EVAC 31 · FIRE 314 ·
 *                                             IMPACT 352 · COLLAPSE 462 · GONE 486 · END 526), beamRadius(), burn()
 *   star.SevenStars / star.Dipper ........... SS-04 timeline (locks 24+4i · lands 290+16i · links 398+5i · finale 440 ·
 *                                             end 560), real Big Dipper RA/Dec layout, crater + trench shapes
 *   star.Carving / star.Erasure ............. full-depth column erase, chunk-by-chunk, spared column
 *   spell.SpellEngine.aimGround ............. target is ALWAYS on the ground (this is what fixes floating craters)
 *   client.cinematic.* ...................... Cutscene / Shot / CameraPose / Subject, easeInOut(), smooth(),
 *                                             fade weight, shot blending, both shot lists (12 + 22 shots)
 *
 * Bedrock limits (honest list):
 *   - camera roll has no script API, FOV only if Camera.setFov exists in your build
 *   - only loaded chunks can be edited, so radii are scaled (see CFG) instead of Java's 200 / 1440 blocks
 *   - post-process GLSL shaders (assets/shaders/*) cannot run on Bedrock, so they are rebuilt as PARTICLES (see FX LIBRARY):
 *       star_beam / star_rays / star_gun -> glow, lens flare, streak and ring particles (red LASER palette)
 *       stars_space / stars_world ......... -> violet star flares, streaks and rings (VIOLET palette)
 *       star_space ........................ -> baked Earth/Moon/planets/Saturn/galaxy/Milky Way sprite atlas
 *       composite (flash / vignette) ...... -> camera.fade + camerashake
 *       armillary_glow / remote_screen .... -> glow particle at the remote
 */
import * as mc from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const { world, system } = mc;

/* ───────────────────────────── CONFIG ───────────────────────────── */
const CFG = {
  sfx: {
    volume: 0.9,        // normal mod sounds (0..1, mid-high)
    bigVolume: 1.0,     // blasts / finale (1.0 is the engine maximum)
    pitch: 1.0,
  },
  cooldownTicks: { the_shooting_star: 1200, seven_stars: 1200 }, // Java: 1200 ticks (60 s)
  creativeCooldown: 20,   // Casting.CREATIVE_COOLDOWN
  railgun: {
    radius: 64,         // Java 200. Bedrock can only edit loaded chunks; raise if your render distance is huge
    keepBottomLayers: 5,// keep the bottom bedrock layers so nobody falls into the void (0 = erase to the very bottom)
    sparePillar: true,  // Java spares the caster's footing column
  },
  dipper: { scale: 0.15 }, // Java lays the Dipper out ~1440 blocks wide; 0.15 => ~216 blocks, craters r 16-21
  cameraMaxDistance: 150,  // Java: max(96, renderDistance*16-26)
  cameraSafeRadius: 40,    // the camera may only sit inside LOADED + TICKING chunks: this far from the player (blocks)
  tickingAreas: true,      // keep the strike zone / star craters loaded + ticking while a skill runs (removed afterwards)
  fxScale: 1.0,            // particle amount multiplier (lower it on weak phones)
  nightForSeven: true,     // Seven Stars sets the world to midnight while it runs, then restores the time
  respectMobGriefing: true,
};

/* ───────────────────────────── REAL CONSTANTS (from bytecode) ───────────────────────────── */
const SS = { ARMED: 5, PRESS: 7, MARK: 9, EVAC: 31, FIRE: 314, IMPACT: 352, COLLAPSE: 462, GONE: 486, DURATION: 526,
             RADIUS: 200, REACH: 420, SKY_AIM: 260 };
const S7 = { ARMED: 5, PRESS: 7, MARK: 9, LOCKS: 24, LOCK_STEP: 4, LAND: 290, LAND_STEP: 16, LINK: 398, LINK_STEP: 5,
             LINK_RUN: 8, FINALE: 440, DURATION: 560, TRENCH_W: 22, TRENCH_DEPTH: 48, REACH: 320, SKY_AIM: 400, MARGIN: 8 };
const landTick = (i) => S7.LAND + i * S7.LAND_STEP;   // SevenStars.landTick
const linkTick = (i) => S7.LINK + i * S7.LINK_STEP;   // SevenStars.linkTick

const SKILLS = {
  the_shooting_star: { id: "the_shooting_star", title: "The Shooting Star", tier: "SS-01 · Railgun", code: "§c", duration: SS.DURATION, short: "SS-01 Railgun",
                       caption: "SS-01 GALACTIC RAILGUN · BEYOND THE RIM · 58,000 LY FROM HOME" },
  seven_stars:       { id: "seven_stars",       title: "The Shooting Star", tier: "SS-04 · Seven Stars", code: "§u", duration: S7.DURATION, short: "SS-04 Seven Stars",
                       caption: "SS-04 SEVEN STARS · STELLAR ARRAY · URSA MAJOR · 79-123 LY" },
};
const SKILL_PROP = "shooting_star:selected_skill";
const CUTSCENE_PROP = "shooting_star:cutscenes_enabled";

const P_STAR = "shooting_star_demo:constellation_star";
const P_IMPACT = "shooting_star_demo:stellar_impact";
const B_CORE = "shooting_star_demo:star_core";
const B_TRACE = "shooting_star_demo:star_trace";
const E_STAR = "shooting_star_demo:falling_star";

/* ───────────────────────────── small helpers ───────────────────────────── */
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const vAdd = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const vSub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const vMul = (a, k) => V(a.x * k, a.y * k, a.z * k);
const vXYZ = (a, x, y, z) => V(a.x + x, a.y + y, a.z + z);
const vLenSq = (a) => a.x * a.x + a.y * a.y + a.z * a.z;
const vDot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vLen = (a) => Math.sqrt(vLenSq(a));
const vNorm = (a) => { const l = vLen(a); return l < 1e-9 ? V() : vMul(a, 1 / l); };
const lerpN = (a, b, t) => a + (b - a) * t;
const vLerp = (a, b, t) => V(lerpN(a.x, b.x, t), lerpN(a.y, b.y, t), lerpN(a.z, b.z, t));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hypot2 = (x, z) => Math.sqrt(x * x + z * z);
const floorV = (a) => V(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z));

const warned = new Set();
function warnOnce(tag, e) {
  if (warned.has(tag)) return;
  warned.add(tag);
  console.warn(`[The Shooting Star] ${tag}: ${e}`);
}
function tryDo(tag, fn) {
  try { return fn(); } catch (e) { warnOnce(tag, e); return undefined; }
}
function valid(e) {
  try { return !!e && (typeof e.isValid === "function" ? e.isValid() : e.isValid !== false); } catch { return false; }
}
function modeOf(player) {
  try { return String(player.getGameMode()).toLowerCase(); } catch { return "survival"; }
}
const isCreativeOrSpectator = (p) => { const m = modeOf(p); return m === "creative" || m === "spectator"; };
const dimMin = (dim) => { try { return dim.heightRange.min; } catch { return -64; } };
const dimMax = (dim) => { try { return dim.heightRange.max; } catch { return 320; } };
function griefing() {
  if (!CFG.respectMobGriefing) return true;
  try { return world.gameRules.mobGriefing !== false; } catch { return true; }
}

/* ───────────────────────────── SOUND (global, mid-high volume) ───────────────────────────── */
/**
 * Every mod sound is played to every player at THEIR OWN position, so distance never attenuates it:
 * you keep hearing the mod wherever you walk, whoever cast it.
 */
/** Where the player's ears are: the cinematic camera during a cutscene (it can be 400 blocks above the body), else the body */
function listenerOf(p) {
  const st = DIRECTOR.get(p.id);
  return st && st.pos ? st.pos : p.location;
}
function sfx(name, opts = {}) {
  const id = `shooting_star_demo.${name}`;
  const vol = Math.min(1, (opts.big ? CFG.sfx.bigVolume : CFG.sfx.volume) * (opts.vol ?? 1));
  const pitch = opts.pitch ?? CFG.sfx.pitch;
  for (const p of world.getAllPlayers()) {
    if (opts.only && opts.only !== p) continue;
    let ok = false;
    // sound_definitions marks every mod sound is3D:false (no distance falloff); the location is only a fallback
    try { p.playSound(id, { volume: vol, pitch, location: listenerOf(p) }); ok = true; } catch (e) { warnOnce("player.playSound", e); }
    if (!ok) tryDo("playsound-cmd", () => p.runCommand(`playsound ${id} @s ~ ~ ~ ${vol} ${pitch} 1`));
  }
}

/* ───────────────────────────── particles / world edit primitives ───────────────────────────── */
/** Particles can only exist inside the build height; anything above dimMax throws and used to vanish silently (that hid the whole space voyage) */
const inBounds = (dim, y) => y > dimMin(dim) && y < dimMax(dim) - 1;
function particle(dim, id, loc) { if (!inBounds(dim, loc.y) || !chunkReady(dim, loc.x, loc.z)) return; try { dim.spawnParticle(id, loc); } catch { /* unknown particle */ } }


/* ───────────────────────────── chunk safety (no more LocationInUnloadedChunk / RuntimeCamera warnings) ───────────────────────────── */
/** true only when the chunk column at (x, z) is loaded (getBlock throws / returns undefined otherwise) */
const CHUNK_CACHE = new Map();
function chunkReady(dim, x, z) {
  const key = `${dim.id}|${x >> 4}|${z >> 4}`, now = system.currentTick, c = CHUNK_CACHE.get(key);
  if (c && now - c.t < 10) return c.ok;
  let ok = false;
  try { ok = !!dim.getBlock({ x: Math.floor(x), y: 64, z: Math.floor(z) }); } catch { ok = false; }
  if (CHUNK_CACHE.size > 600) CHUNK_CACHE.clear();
  CHUNK_CACHE.set(key, { t: now, ok });
  return ok;
}
const AREAS_KEY = "shooting_star:tick_areas";
let areaSeq = 0;
function saveAreas(list) { try { world.setDynamicProperty(AREAS_KEY, list.length ? JSON.stringify(list) : undefined); } catch { /* ignore */ } }
const LIVE_AREAS = []; // { dim, name }
/** Keep a circle of chunks loaded AND ticking around (x, z) while a skill runs. Silent if the world is at its ticking-area limit. */
function addArea(spell, x, z, chunks) {
  if (!CFG.tickingAreas) return;
  const name = `ssd_${system.currentTick}_${++areaSeq}`;
  try {
    spell.dim.runCommand(`tickingarea add circle ${Math.floor(x)} 64 ${Math.floor(z)} ${chunks} ${name} true`);
    spell.areas.push({ name, x, z, r: chunks * 16 - 8 });
    LIVE_AREAS.push({ dim: spell.dim.id, name });
    saveAreas(LIVE_AREAS);
  } catch { /* limit reached or command unavailable: the camera clamp below still keeps everything inside loaded chunks */ }
}
function releaseAreas(spell) {
  for (const a of spell.areas.splice(0)) {
    tryDo("tickingarea.remove", () => spell.dim.runCommand(`tickingarea remove ${a.name}`));
    const i = LIVE_AREAS.findIndex((x) => x.name === a.name);
    if (i >= 0) LIVE_AREAS.splice(i, 1);
  }
  saveAreas(LIVE_AREAS);
}
system.runTimeout(() => { // a crash can leave areas behind: remove what a previous session registered (never the live ones)
  tryDo("tickingarea.cleanup", () => {
    const raw = world.getDynamicProperty(AREAS_KEY);
    if (typeof raw !== "string") return;
    const live = new Set(LIVE_AREAS.map((a) => a.name));
    for (const a of JSON.parse(raw)) if (!live.has(a.name)) tryDo("tickingarea.remove", () => world.getDimension(a.dim).runCommand(`tickingarea remove ${a.name}`));
    saveAreas(LIVE_AREAS);
  });
}, 60);

/** Disks (centre + radius, blocks) where a camera is guaranteed to be in a loaded + ticking chunk */
function safeDisks(player) {
  const l = player.location, disks = [{ x: l.x, z: l.z, r: CFG.cameraSafeRadius }];
  for (const sp of ACTIVE.values()) {
    if (sp.dim.id !== player.dimension.id) continue;
    for (const a of sp.areas) if (chunkReady(sp.dim, a.x, a.z)) disks.push(a);
  }
  return disks;
}
/** RuntimeCamera fix: pull the camera horizontally to the nearest safe disk (height is free, chunks are columns) */
function clampSafe(player, pos) {
  let best = null, bestGap = Infinity;
  for (const k of safeDisks(player)) {
    const dx = pos.x - k.x, dz = pos.z - k.z, d = Math.hypot(dx, dz);
    if (d <= k.r - 0.5) return pos;
    if (d - k.r < bestGap) { bestGap = d - k.r; best = V(k.x + dx * ((k.r - 1) / d), pos.y, k.z + dz * ((k.r - 1) / d)); }
  }
  return best ?? pos;
}

/* ═════════════════════════════ FX LIBRARY — the Java GLSL shaders rebuilt as Bedrock particles ═════════════════════════════ */
const FXP = {
  glow: "shooting_star_demo:fx_glow", flare: "shooting_star_demo:fx_flare", ring: "shooting_star_demo:fx_ring",
  ringStatic: "shooting_star_demo:fx_ring_static", streak: "shooting_star_demo:fx_streak", ember: "shooting_star_demo:fx_ember",
  sprite: "shooting_star_demo:fx_sprite", spriteAdd: "shooting_star_demo:fx_sprite_add",
  ringView: "shooting_star_demo:fx_ring_view", starDisc: "shooting_star_demo:fx_star_disc", ringsys: "shooting_star_demo:fx_ringsys", skyTile: "shooting_star_demo:fx_sky_tile", cloud: "shooting_star_demo:fx_cloud", label: "shooting_star_demo:fx_label", orbit: "shooting_star_demo:fx_orbit",
  corona: "shooting_star_demo:fx_corona", beam: "shooting_star_demo:fx_beam",
};
const COL = { laser: [1, 0.045, 0.07], laserHot: [1, 0.55, 0.6], pale: [1, 0.92, 0.72], violet: [0.62, 0.48, 1], violetHot: [0.86, 0.8, 1],
              white: [1, 1, 1], cyan: [0.3, 0.85, 1], gold: [1, 0.8, 0.35] };            // star.glsl / stars_space.fsh palettes
const ATLAS = { earth: [0, 0, 256, 256], moon: [256, 0, 128, 128], saturn: [384, 0, 128, 128], jupiter: [256, 128, 64, 64],
                mars: [320, 128, 64, 64], venus: [384, 128, 64, 64], mercury: [448, 128, 64, 64], uranus: [256, 192, 64, 64],
                neptune: [320, 192, 64, 64], sun: [384, 192, 64, 64], galaxy: [0, 256, 256, 256], milky: [0, 512, 512, 64] };
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const gauss = (s) => (Math.random() + Math.random() + Math.random() - 1.5) * (s / 0.75);

function fx(dim, id, loc, o = {}) {
  if (!inBounds(dim, loc.y) || !chunkReady(dim, loc.x, loc.z)) return;
  try {
    const m = new mc.MolangVariableMap(), c = o.color ?? COL.white;
    m.setFloat("variable.sx", o.sx ?? 1); m.setFloat("variable.size", o.size ?? 1); m.setFloat("variable.life", o.life ?? 1); m.setFloat("variable.hold", o.hold ? 1 : 0);
    m.setFloat("variable.r", c[0]); m.setFloat("variable.g", c[1]); m.setFloat("variable.b", c[2]); m.setFloat("variable.a", o.a ?? 1);
    if (o.w !== undefined) { m.setFloat("variable.w", o.w); m.setFloat("variable.h", o.h ?? 1); }
    if (o.atlas) {
      m.setFloat("variable.u", o.atlas[0]); m.setFloat("variable.v", o.atlas[1]);
      m.setFloat("variable.uw", o.atlas[2]); m.setFloat("variable.uh", o.atlas[3]); m.setFloat("variable.aspect", o.atlas[3] / o.atlas[2]);
    }
    if (o.speed !== undefined) { m.setFloat("variable.speed", o.speed); m.setFloat("variable.rise", o.rise ?? 0); }
    dim.spawnParticle(id, loc, m);
  } catch { /* chunk not loaded / pack still loading: effects are cosmetic, never warn */ }
}
const fxGlow = (d, l, size, life, color, a = 1, hold = false) => fx(d, FXP.glow, l, { size, life, color, a, hold });
const fxFlare = (d, l, size, life, color, a = 1, hold = false) => fx(d, FXP.flare, l, { size, life, color, a, hold });
const fxRingView = (d, l, radius, life, color, a = 1, hold = false) => fx(d, FXP.ringView, l, { size: radius, life, color, a, hold });
const fxOrbit = (d, l, radius, life, a = 1) => fx(d, FXP.orbit, l, { size: radius, life, color: COL.white, a, hold: true });
const LABEL_KEYS = { SOL: 7 };
/** FxManager$Label / StarPath$Tag / SevenStarsPath$Tag — HUD tags rebuilt as camera-facing text sprites (bracket + name + 'α UMa · 123 LY').
 *  PC behaviour (matched here): the NAME label shows ONE star at a time; once the next star takes over, the previous name is gone
 *  but its target bracket [  ] stays.  named=true -> cell idx (DUBHE..ALKAID/SOL), named=false -> generic NODE target cell. */
function fxLabel(d, l, idx, halfH, life, a = 1, named = true) {
  const cell = named ? idx : 8 + (idx % 7);            // 8..14 = bracket-only target markers ("NODE n")
  fx(d, FXP.label, l, { size: halfH, life, color: COL.white, a, atlas: [(cell % 2) * 192, Math.floor(cell / 2) * 48, 192, 48], hold: true });
}
/** which star currently OWNS the name label (all the others show only their target bracket) */
function namedStar(t) {
  if (t >= S7.LOCKS && t < 52) return clamp(Math.floor((t - S7.LOCKS) / S7.LOCK_STEP), 0, 6);
  if (t >= 150 && t < 192) return clamp(Math.floor((t - 150) / 6), 0, 6);
  if (t >= 200 && t < 228) return clamp(Math.floor((t - 200) / 4), 0, 6);
  return -1;
}
const fxRing = (d, l, radius, life, color, a = 1) => fx(d, FXP.ring, l, { size: radius, life, color, a });
const fxRingStatic = (d, l, radius, life, color, a = 1) => fx(d, FXP.ringStatic, l, { size: radius, life, color, a });
const fxStreak = (d, l, w, h, life, color, a = 1) => fx(d, FXP.streak, l, { w, h, life, color, a });
/** beam corona: a tall soft TRANSPARENT white glow pillar (star_beam.fsh corona) — never a textured sprite strip */
const fxCorona = (d, l, w, h, life, color, a = 1, hold = false) => fx(d, FXP.corona, l, { w, h, life, color, a, hold });
const fxBeam = (d, l, w, h, life, color, a = 1, hold = false) => fx(d, FXP.beam, l, { w, h, life, color, a, hold });
function fxEmbers(d, c, n, spread, speed, rise, size, life, color, a = 0.9) {
  n = Math.max(1, Math.round(n * CFG.fxScale));
  for (let i = 0; i < n; i++) fx(d, FXP.ember, V(c.x + gauss(spread), c.y + Math.abs(gauss(spread * 0.3)), c.z + gauss(spread)),
    { size: size * rnd(0.6, 1.2), life: life * rnd(0.7, 1.3), color, a, speed: speed * rnd(0.4, 1), rise: rise * rnd(0.6, 1.2) });
}
function fxSprite(d, name, l, size, life, a = 1, additive = false) {
  fx(d, additive ? FXP.spriteAdd : FXP.sprite, l, { size, life, a, atlas: ATLAS[name] });
}
/** composite.fsh Flash / Vignette -> camera.fade overlay, only for players within `range` blocks of `at` */
function flash(dim, color, times, at, range) {
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== dim.id) continue;
    if (at && range && hypot2(p.location.x - at.x, p.location.z - at.z) > range) continue;
    tryDo("camera.fade", () => p.camera.fade({
      fadeColor: { red: color[0], green: color[1], blue: color[2] },
      fadeTime: { fadeInTime: times[0], holdTime: times[1], fadeOutTime: times[2] },
    }));
  }
}
/** flash() for everybody who is NOT inside a cutscene (the cutscene has its own per-star flashes) */
function flashFree(dim, color, times, at, range) {
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== dim.id || DIRECTOR.has(p.id)) continue;
    if (at && range && hypot2(p.location.x - at.x, p.location.z - at.z) > range) continue;
    tryDo("camera.fade", () => p.camera.fade({ fadeColor: { red: color[0], green: color[1], blue: color[2] }, fadeTime: { fadeInTime: times[0], holdTime: times[1], fadeOutTime: times[2] } }));
  }
}
const skyDir = (az, el) => V(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)); // unit vector from heading + elevation
/** star_space.fsh / stars_space.fsh backdrop: Moon, planets, Saturn, galaxy and Milky Way sprites.
 *  Fixed bearings from the cast heading (they never swing with the camera) and re-spawned with a life of ~2 ticks, so only one copy
 *  exists at a time — this is what removes the duplicated planets. Placed 36 blocks away (inside loaded chunks) and scaled down. */
const SKY_ANCHORS = [ // name, azimuth, elevation (rad), size at 200 blocks, alpha, additive
  ["milky", 0.2, 0.62, 300, 0.9, true], ["galaxy", -0.5, 1.15, 70, 0.55, true], ["moon", 0.75, 0.48, 24, 1, false],
  ["saturn", -0.95, 0.34, 15, 1, false], ["jupiter", 0.15, 0.95, 7, 1, false], ["mars", 1.25, 0.28, 5, 1, false],
  ["venus", -0.2, 0.3, 4, 1, false], ["sun", -1.5, 0.52, 20, 1, true], ["earth", Math.PI, -0.55, 130, 1, false],
];
function spaceDress(dim, cam, heading, strong) {
  const D = 36, k = D / 200;
  for (const [name, az, el, size, a, add] of SKY_ANCHORS) {
    const p = vAdd(cam, vMul(skyDir(heading + az, el), D));
    if (!chunkReady(dim, p.x, p.z)) continue;
    fx(dim, add ? FXP.spriteAdd : FXP.sprite, p, { size: size * k, life: LF, color: COL.white, a: a * strong, atlas: ATLAS[name], hold: true });
    if (name === "sun") fxOrbit(dim, p, 9, LF, 0.7 * strong);          // the dashed orbit rings around Sol
  }
}
/** client.fx.CastTitles — big title + the SS-0x caption, visible to everyone within 160 blocks of the caster, LIFE = 70 ticks */
const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x, 0, 1)));
function castTitle(spell) {
  const sk = spell.skill, c = spell.caster;
  if (!valid(c)) return;
  const text = sk.title.toUpperCase(), FRAMES = 18, MAXSP = 5;
  let f = 0;
  const id = system.runInterval(() => {
    const sp = Math.round(MAXSP * (1 - easeOutExpo(f / (FRAMES - 1))));       // letter gap: 5 -> 0, fast first, then a sharp deceleration
    const gap = " ".repeat(sp);
    const spaced = text.split(" ").map((w) => w.split("").join(gap)).join(" ".repeat(sp * 2 + 1));
    if (valid(c)) for (const p of world.getAllPlayers()) {
      if (p.dimension.id !== c.dimension.id || vLen(vSub(p.location, c.location)) > 160) continue;
      tryDo("title", () => p.onScreenDisplay.setTitle(`${sk.code}${spaced}`, { subtitle: `§7${sk.caption}`, fadeInDuration: f === 0 ? 4 : 0, stayDuration: f === FRAMES - 1 ? 44 : 6, fadeOutDuration: 20 }));
    }
    if (++f >= FRAMES) system.clearRun(id);
  }, 1);
}
/** SevenStarsHud: "IMPACT 1 · DUBHE" / "α URSAE MAJORIS · 123 LY · CRATER Ø282" (diameter of the Java crater) */
function impactTitle(spell, i) {
  const c = spell.caster;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== spell.dim.id) continue;
    if (valid(c) && vLen(vSub(p.location, c.location)) > 400 && p.id !== c.id) continue;
    tryDo("impact-title", () => p.onScreenDisplay.setTitle(`§u${"IMPACT " + (i + 1)} · ${DIPPER.NAMES[i]}`,
      { subtitle: `§7${DIPPER.GREEK[i]} URSAE MAJORIS · ${DIPPER.LY[i]} LY · CRATER Ø${Math.round(craterRadius(i) * 2)}`, fadeInDuration: 2, stayDuration: 28, fadeOutDuration: 10 }));
  }
}
/** Long-lived embers around the crater(s) — Java keeps these going for 800 ticks after the beam / finale */
function aftermath(dim, centres, ticks, colors, spread) {
  let n = 0;
  const id = system.runInterval(() => {
    if (++n > ticks / 6) { system.clearRun(id); return; }
    const c = centres[Math.floor(Math.random() * centres.length)];
    if (!chunkReady(dim, c.x, c.z)) return;
    fxEmbers(dim, V(c.x, c.y + 0.5, c.z), 3, spread, 0.12, 0.05, 0.9, 2.2, colors[Math.floor(Math.random() * colors.length)], 0.8);
  }, 6);
}
/** StarHud / SevenStarsHud text — the exact Java strings, shown as an action-bar caption while the cutscene runs */
const tf = (x) => Math.max(0, x).toFixed(2).padStart(5, "0");
const tourT = (i) => 150 + 6 * i;              // SevenStarsPath.ARRAY = 150, ARRAY_STEP = 6 (ALL_AWAKE = 192)
const fireT = (i) => 200 + 4 * i;              // SevenStarsPath.FIRE = 200, FIRE_STEP = 4
const firedCount = (t) => { let n = 0; for (let i = 0; i < 7; i++) if (t >= fireT(i)) n++; return n; };
const lerpLog = (a, b, u) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * clamp(u, 0, 1));
function rangeText(t, turn = 0) { // SevenStarsHud: "RANGE %,.1f LY" / "RANGE %,.0f KM" from SevenStarsPath.rangeKm (the real voyage geometry)
  const km = s4RangeKm(Math.max(t, 58), turn);
  return km > KM_LY ? `RANGE ${(km / KM_LY).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} LY` : `RANGE ${Math.round(km).toLocaleString("en-US")} KM`;
}
function cinematicHud(player, cut) {
  const t = cut.age, skip = cut.skipped ? "" : "  §8· §7Sneak: skip";
  let line;
  if (cut.skill.id === "the_shooting_star") {
    const left = (SS.IMPACT - t) / 20;
    if (t < SS.MARK) line = "§cUPLINK // SS-01 > THE SHOOTING STAR";
    else if (t < SS.FIRE) line = `§cTARGET ACQUIRED §7· §fTARGET SOL-3 · LOCKED §7· §fT-${tf(left)}`;
    else if (t < SS.IMPACT) line = `§4§lINBOUND §r§cORBITAL STRIKE INBOUND §7· §fT-${tf(left)}`;
    else if (t < SS.COLLAPSE) line = "§f§lIMPACT CONFIRMED §r§7· §cSTRIKE RADIUS 200 · FULL DEPTH";
    else if (t < SS.GONE) line = "§cSHAFT Ø400 · WORLD TOP TO VOID";
    else line = "§cSS-01 GALACTIC RAILGUN · BEYOND THE RIM · 58,000 LY FROM HOME";
  } else {
    let hit = 0, links = 0;
    for (let i = 0; i < 7; i++) { if (t >= landTick(i)) hit++; if (t >= linkTick(i) + 4) links++; }
    const locks = clamp(Math.floor((t - S7.LOCKS) / S7.LOCK_STEP) + 1, 0, 7);
    const first = (landTick(0) - t) / 20, online = clamp(Math.floor((t - 150) / 6) + 1, 0, 7);
    let txt;
    if (t < S7.LOCKS) txt = "UPLINK // SS-04 > SEVEN STARS";
    else if (t < 52) txt = `STELLAR LOCK ${locks} / 7`;
    else if (t < 70) txt = "URSA MAJOR · 7 STARS · 7 LINES · 216 BLOCKS";
    else if (t < 118) txt = `LEAVING SOL · ${rangeText(t, cut.sp ? cut.sp.turn : 0)}`;
    else if (t < 130) txt = "PARALLAX · THE FIGURE ONLY HOLDS FROM SOL";
    else if (t < 150) txt = `URSA MAJOR · 7 STARS · 7 LINES · ${rangeText(t, cut.sp ? cut.sp.turn : 0)}`;
    else if (t < 192) txt = `ARRAYS ${online} / 7 ONLINE · ${DIPPER.NAMES[online - 1]} · ${rangeText(t, cut.sp ? cut.sp.turn : 0)}`;
    else if (t < 200) txt = `ARRAYS 7 / 7 ONLINE · ${rangeText(t, cut.sp ? cut.sp.turn : 0)}`;
    else if (t < 228) txt = `FIRE ${Math.max(1, firedCount(t))} / 7 · ${rangeText(t, cut.sp ? cut.sp.turn : 0)}`;
    else if (t < 256) txt = `FIRED 7 / 7 · ${rangeText(t, cut.sp ? cut.sp.turn : 0)}`;
    else if (t < landTick(0)) txt = `FIGURE RE-FORMED · SOL-3 · ${rangeText(t, cut.sp ? cut.sp.turn : 0)}`;
    else if (hit < 7 || t < landTick(6) + 20) txt = `IMPACTS ${hit} / 7`;
    else if (t < S7.FINALE) txt = `LINK ${Math.min(links, 7)} / 7 · LINKING`;
    else if (t < 476) txt = "CONSTELLATION BURNED";
    else if (t < 526) txt = "FIGURE RE-FORMED · SOL-3";
    else txt = "URSA MAJOR BURNED";
    line = `§u[ ${txt} ]` + (t < landTick(0) ? `  §7T+${(t / 20).toFixed(2).padStart(5, "0")} §8| §7FIRST IMPACT T-${tf(first)}` : "");
  }
  player.onScreenDisplay.setActionBar(line + skip);
}
/* ═════════════════════════════ SKY / SPACE ENGINE ═════════════════════════════
 * LevelRendererMixin + stars_space.fsh + StarPath/SevenStarsPath, rebuilt for Bedrock.
 *
 *  - SKY DOME  : ONE connected sphere on ONE depth layer: 30 camera-facing tiles on a Fibonacci sphere, tile angular half-size
 *                40° (>> the 23° covering radius) so every point of the sky is covered by several overlapping tiles — the vanilla
 *                night sky, stars and moon_phases can never show through the gaps. All tiles sample ONE 3x3 combined atlas
 *                (sky_sphere_atlas, "like cloud_atlas but 3 wide, not 4"). Distance 48 keeps every tile spawn-safe under the
 *                build limit. The dome is removed when the fired stars reach Earth (fade 256-280) and fades out again at the end.
 *  - VIRTUAL CAMERA : SevenStarsPath.shot() is ported 1:1. During the voyage the Bedrock camera stays on ONE anchor point and only
 *                turns; everything astronomical (Earth, Moon, Sun, the 7 stars, speed lines, the array of each star) is placed from
 *                the virtual camera's real light-year geometry, so parallax and positions are the Java mod's.
 *  - one copy of everything: world-fixed particles are re-spawned every tick at the SAME position, camera-relative ones live < 1.5 ticks.
 */
const RAD = Math.PI / 180;
const LF = 0.065;                                           // life (s) of per-tick particles: re-spawned every tick, never two stale copies
const ASPECT = 2.35;                                        // widest screen we cull for (phones are ~2.2:1)
const vCross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const smoothF = (x) => smooth(x);
const ramp = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
/** SevenStarsFx.window(x, a, b, c, d): smooth rise a->b, 1 between b and c, smooth fall c->d */
const win4 = (x, a, b, c, d) => (x <= a || x >= d ? 0 : x < b ? smooth((x - a) / (b - a)) : x <= c ? 1 : 1 - smooth((x - c) / (d - c)));
function vSlerp(a, b, k) {                                  // StarPath.slerp
  const dot = clamp(vDot(a, b), -1, 1), th = Math.acos(dot) * k, rel = vSub(b, vMul(a, dot));
  return vLen(rel) < 1e-9 ? a : vAdd(vMul(a, Math.cos(th)), vMul(vNorm(rel), Math.sin(th)));
}
function pchip(t, xs, ys) {                                 // StarPath.pchip (monotone cubic Hermite)
  const n = xs.length;
  if (t <= xs[0]) return ys[0];
  if (t >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (i < n - 2 && t > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i], d = (j) => (ys[j + 1] - ys[j]) / (xs[j + 1] - xs[j]);
  const m = (j) => {
    if (j === 0 || j === n - 1) return j === 0 ? d(0) : d(n - 2);
    const a = d(j - 1), b = d(j);
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  };
  const u = (t - xs[i]) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m(i) + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m(i + 1);
}
/** Bedrock camera basis for a camera that looks along f with roll 0 (right, up, forward) */
function bedBasis(f0) {
  const f = vNorm(f0);
  let r = V(-f.z, 0, f.x);
  r = vLenSq(r) < 1e-6 ? V(1, 0, 0) : vNorm(r);
  return { r, u: vCross(r, f), f };
}

/* ── StarPath constants (frame 0 = Earth radii around the Earth, frame 2 = light years around Sol) ── */
const AU_LY = 1.5812501680078302e-5, ER_AU = 4.258750455597227e-5, KM_LY = 9.4607e12, RSUN_LY = 7.353578487849736e-8, SUN_R_AU = 0.00465;
const SPATH = (() => {
  const L = V(0, 1, 0), NU = V(0, 0, -1), EU = V(1, 0, 0);
  const SUN_DIR = vNorm(vAdd(vMul(L, Math.sin(38 * RAD)), vMul(vNorm(vAdd(vMul(EU, -0.64), vMul(NU, -0.77))), Math.cos(38 * RAD))));
  const ASIDE = vNorm(vAdd(vMul(EU, 0.8), vMul(NU, 0.5)));
  const MOON_E = vMul(vNorm(vAdd(vMul(L, -0.75), vAdd(vMul(EU, -0.4), vMul(NU, 0.53)))), 60.3);
  const EARTH_S = vMul(SUN_DIR, -1);
  const GALAXY_N = vNorm(vAdd(vMul(L, Math.sin(42 * RAD)), vMul(vNorm(vAdd(vMul(EU, 0.35), vMul(NU, 0.94))), Math.cos(42 * RAD))));
  return { L, NU, EU, SUN_DIR, ASIDE, MOON_E, EARTH_S, GALAXY_N, EARTH_U: vMul(EARTH_S, AU_LY) };
})();
const S4 = {
  RADIUS: [30, 3, 3, 1.4, 4.1, 2.4, 3.4],
  CLIMB_T: [58, 70, 78, 84, 90, 96], CLIMB_H: [0.002, 0.02, 0.4, 2, 12, 60].map(Math.log10),
  OUT_T: [96, 100, 108, 118, 126, 130], OUT_LEFT: [1, 0.999, 0.8, 0.45, 0.2, 0.12],
};
const s4Star = (i, turn) => vMul(dipperSkyDir(i, turn), DIPPER.LY[i]);                 // SevenStarsPath.star
function s4Centroid(turn) { let c = V(); for (let i = 0; i < 7; i++) c = vAdd(c, s4Star(i, turn)); return vMul(c, 1 / 7); }
const s4ArrayR = (i) => Math.max(S4.RADIUS[i], 2) * RSUN_LY * 6;                        // SevenStarsPath.arrayR
const s4Awake = (ct, i) => smooth((ct - (150 + i * 6)) / 5);                            // SevenStarsPath.awake
const s4Fired = (ct, i) => (ct >= 200 + i * 4 ? (ct - (200 + i * 4)) / 20 : -1);       // SevenStarsPath.fired
function s4Homeward(ct, i) {                                                            // SevenStarsPath.homeward
  const at = 200 + i * 4;
  if (ct < at) return 0;
  const LY = DIPPER.LY[i], ts = [at, at + 2, 228, 256, 272];
  const ls = [Math.log10(LY), Math.log10(LY * 0.97), Math.log10(20), Math.log10(0.02), Math.log10(1e-6)];
  return 1 - Math.pow(10, pchip(ct, ts, ls)) / LY;
}
function s4ShotAt(ct, i, turn) {                                                        // SevenStarsPath.shotAt
  const s = s4Star(i, turn);
  return vAdd(SPATH.EARTH_U, vMul(vSub(s, SPATH.EARTH_U), 1 - s4Homeward(ct, i)));
}
/** SevenStarsPath.shot(ct, turn) -> the virtual camera { frame, pos, fwd, up, right, fov }.
 *  Difference from the Java source: inside each star's array (150-192) the camera looks EXACTLY at the star (no aim offset) and does
 *  not drift, so the star is dead-centre on the crosshair and perfectly steady. */
function sevenShot(ct, turn) {
  const mk = (frame, pos, look, upHint, fov) => {
    const fwd = vNorm(vSub(look, pos)), right = vNorm(vCross(fwd, upHint));
    return { frame, pos, fwd, up: vCross(right, fwd), right, fov };
  };
  const { L, NU, EU, ASIDE, EARTH_U } = SPATH, c = s4Centroid(turn), k = (a, b) => smooth((ct - a) / (b - a));
  if (ct < 96) {
    const h = Math.pow(10, pchip(ct, S4.CLIMB_T, S4.CLIMB_H));
    const pos = vAdd(vMul(L, 1 + h), vMul(ASIDE, h * 0.25));
    const up = vNorm(vSub(vMul(L, 10), vMul(NU, 1.5)));
    const look = vAdd(pos, vSlerp(up, vNorm(c), k(70, 96)));
    return mk(0, pos, look, NU, lerpN(62, 56, k(84, 96)));
  }
  if (ct < 150 || (ct >= 192 && ct < 230)) {
    let left = 0.12;
    for (let i = 0; i < 5; i++) if (ct >= S4.OUT_T[i] && ct < S4.OUT_T[i + 1]) left = lerpN(S4.OUT_LEFT[i], S4.OUT_LEFT[i + 1], (ct - S4.OUT_T[i]) / (S4.OUT_T[i + 1] - S4.OUT_T[i]));
    const toSun = vNorm(vMul(c, -1)), across = vNorm(vCross(toSun, L));
    let pos, look, fov;
    if (ct < 130) {
      pos = vAdd(EARTH_U, vMul(vSub(c, EARTH_U), 1 - left)); look = c; fov = lerpN(56, 70, k(96, 130));
    } else {
      const a = lerpN(-0.35, 0.35, k(130, 230));
      pos = vAdd(c, vAdd(vMul(vSlerp(vMul(toSun, -1), across, 0.55 + a * 0.3), 95), vMul(L, 22)));
      look = vLerp(c, V(), 0.12); fov = lerpN(70, 64, k(130, 230));
    }
    return mk(2, pos, look, L, fov);
  }
  if (ct < 192) {
    const i = clamp(Math.floor((ct - 150) / 6), 0, 6), s = s4Star(i, turn), r = s4ArrayR(i);
    const aim = vNorm(vMul(s, -1)), side = vNorm(vCross(aim, L));
    const pos = vAdd(s, vAdd(vMul(side, r * 3.2), vAdd(vMul(aim, r * 1.6), vMul(L, r * 0.9))));
    return mk(2, pos, s, L, 58);
  }
  if (ct < 256) {
    const s = s4ShotAt(ct, 3, turn), dir = vNorm(vSub(EARTH_U, s)), back = vLen(vSub(s, EARTH_U)) * 0.02;
    return mk(2, vSub(s, vMul(dir, back)), vAdd(s, vMul(dir, back * 3)), L, lerpN(62, 74, k(228, 256)));
  }
  const m = k(256, 272), pos = vAdd(vMul(L, 1 + lerpN(0.8, 0.05, m)), vMul(ASIDE, 0.05));
  return mk(0, pos, vAdd(pos, vSub(vMul(L, 10), vMul(ASIDE, 1))), NU, lerpN(74, 70, m));
}
/** SevenStarsPath.rangeKm */
function s4RangeKm(ct, turn) {
  const c = sevenShot(ct, turn);
  return c.frame === 0 ? vLen(c.pos) * 6371 : vLen(c.pos) * KM_LY;
}
/** camera position in Earth radii (e), AU (s) and light years (u) */
function s4Geom(vs) {
  if (vs.frame === 0) { const e = vs.pos, s = vAdd(SPATH.EARTH_S, vMul(e, ER_AU)); return { e, s, u: vMul(s, AU_LY) }; }
  const u = vs.pos, s = vMul(u, 1 / AU_LY);
  return { u, s, e: vMul(vSub(s, SPATH.EARTH_S), 1 / ER_AU) };
}

/* ── SKY DOME ──
 * ONE connected sphere on ONE depth layer ("one, not four"): 30 camera-facing tiles on a Fibonacci sphere with the tile
 * half-extent 1.6× the covering radius, so every point of the sky is covered by several overlapping tiles — the vanilla
 * night sky, stars and moon_phases can NEVER show through the gaps (this is what made the old dome look like separate boxes).
 * All tiles come from ONE combined atlas (sky_sphere_atlas = 3×3 of 512px starfield tiles, like cloud_atlas but 3 wide, not 4).
 * Distance 48 keeps every tile centre inside the build height even with the camera at the top of the scenes (spawn-safe). */
const SKY = { N: 30, D: 48, HALF: 0.85 };                   // HALF = tan(40°): tile angular half-size 40° >> covering radius ~23° of 30 points
const SKY_TILE = (() => {
  const out = [], g = Math.PI * (1 + Math.sqrt(5));
  for (let i = 0; i < SKY.N; i++) {
    const y = 1 - (2 * (i + 0.5)) / SKY.N, r = Math.sqrt(1 - y * y), th = g * (i + 0.5), d = V(Math.cos(th) * r, y, Math.sin(th) * r);
    const t = i % 9;                                                                    // 3×3 atlas cell for this tile
    out.push({ d, u: (t % 3) * 512, v: Math.floor(t / 3) * 512 });
  }
  return out;
})();
const SKY_FX = "shooting_star_demo:fx_sky_tile";
/** Opaque star-field dome around `anchor`. mapDir maps a sky direction into Bedrock world space (virtual camera); null = world-fixed.
 *  horizonOnly keeps the ground visible (tiles whose centre is clearly below the horizon are skipped). Returns tiles spawned. */
function skyDome(dim, anchor, mapDir, fwd, fovDeg, alpha, horizonOnly, lowAlpha = alpha) {
  if (alpha <= 0.02) return 0;
  const tanH = Math.tan((fovDeg * RAD) / 2), reach = Math.min(Math.PI, Math.atan(tanH * ASPECT) + 0.5);
  const lim = Math.cos(Math.min(Math.PI, reach + 0.55)), a = Math.min(1, alpha);
  let n = 0;
  for (let i = 0; i < SKY_TILE.length; i++) {
    const T = SKY_TILE[i], d = mapDir ? mapDir(T.d) : T.d;
    if (vDot(d, fwd) < lim) continue;
    const low = d.y < -0.12;
    if (low && (horizonOnly || lowAlpha <= 0.02)) continue;
    const Dk = SKY.D + i * 0.012, pos = vAdd(anchor, vMul(d, Dk));                      // unique depth per tile -> stable order, no flicker in overlaps
    if (!inBounds(dim, pos.y) || !chunkReady(dim, pos.x, pos.z)) continue;
    fx(dim, SKY_FX, pos, { size: Dk * SKY.HALF * (CFG.skyScale ?? 1), life: LF, color: COL.white, a: low ? Math.min(1, lowAlpha) : a, atlas: [T.u, T.v, 512, 512], hold: true });
    n++;
  }
  return n;
}
/** after a cutscene: the dome dissolves over `dur` ticks, so the real sky (and the moon) fade back in */
const SKYFADE = new Map(); // player.id -> { t0, a0, dur }
function skyFadeBegin(player, a0, dur = 44) { if (a0 > 0.05) SKYFADE.set(player.id, { t0: system.currentTick, a0, dur }); }
system.runInterval(() => {
  if (!SKYFADE.size) return;
  const now = system.currentTick;
  for (const [id, s] of [...SKYFADE.entries()]) {
    const p = world.getAllPlayers().find((x) => x.id === id);
    const a = s.a0 * (1 - (now - s.t0) / s.dur);
    if (!p || !valid(p) || a <= 0.03 || DIRECTOR.has(id)) { SKYFADE.delete(id); continue; }
    tryDo("sky-fade", () => skyDome(p.dimension, p.getHeadLocation(), null, p.getViewDirection(), 70, a, true));
  }
}, 1);

/* ── CLOUD DECK: you really pass through clouds while leaving the atmosphere (stars_space.fsh dissolve / earth_clouds) ── */
const cloudHash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
/** flat cloud layers every ~13 blocks between y0 and y1, world-fixed (same positions every tick), only those near the camera are drawn */
function cloudDeck(dim, cam, y0, y1, a = 0.88) {
  const gap = 13, k0 = Math.ceil(y0 / gap), k1 = Math.floor(y1 / gap);
  for (let k = k0; k <= k1; k++) {
    const y = k * gap;
    if (Math.abs(y - cam.y) > 60) continue;
    for (let j = 0; j < 3; j++) {
      const h1 = cloudHash(k, j), h2 = cloudHash(k + 17, j * 3 + 1), h3 = cloudHash(k * 3 + 5, j + 9);
      const pos = V(cam.x + (h1 - 0.5) * 70, y, cam.z + (h2 - 0.5) * 70), tile = Math.floor(h3 * 8);
      fx(dim, FXP.cloud, pos, { size: 34 + h3 * 30, life: LF, color: COL.white, a, atlas: [(tile % 4) * 256, Math.floor(tile / 4) * 256, 256, 256], hold: true });
    }
  }
}
/** the pale cloud fog of the dissolve (stars_space.fsh: fog = sin(dis*PI), colour 0.92/0.94/1.0) — replaces the hard white flash */
function fogFade(player) {
  tryDo("fog-fade", () => player.camera.fade({ fadeColor: { red: 0.92, green: 0.94, blue: 1.0 }, fadeTime: { fadeInTime: 0.3, holdTime: 0.05, fadeOutTime: 0.55 } }));
}

/* ═════════════════════════════ ScreenFx (client.render.ScreenFx / composite + post shaders -> camera + particles) ═════════════════════════════
 * flash -> overlay glow in front of the lens (+ camera.fade when strong), shake -> /camerashake, zoomBlur -> speed lines,
 * bloom -> soft haze glow. Aberration / grain / vignette need a GPU pass; they are approximated by the haze + the shake. */
class ScreenFx {
  constructor() { this.shake = 0; this.flashA = 0; this.flashC = [1, 1, 1]; this.zoomBlur = 0; this.bloom = 0; this.aberration = 0; }
  addFlash(rgb, a) { if (a > this.flashA) { this.flashA = a; this.flashC = [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255]; } }
}
/** SevenStarsFx.filmScreen — the exact triggers of the Java mod for the voyage (jumps, fire flashes, ride blur, return flash).
 *  The ARRAYS phase is deliberately free of shake/flash: the camera must sit perfectly steady on each star (the PC cutscene
 *  teleports the view per star — anything shake-like here reads as camera wobble and is wrong). */
function filmScreen(sx, ct) {
  const cover = SevenStarsCover(ct);
  if (cover > 0.001) sx.bloom = Math.max(sx.bloom, 0.6);
  for (const jump of [96, 130]) {
    const k = win4(ct, jump - 1, jump, jump + 1, jump + 5);
    sx.aberration = Math.max(sx.aberration, k * 0.9);
    sx.addFlash(14208255, k * 0.25);
  }
  for (let i = 0; i < 7; i++) {
    const f = 200 + i * 4, kf = win4(ct, f, f + 0.25, f + 0.5, f + 2);        // one SHORT white splash per fire — flash in a second, never a long wash
    sx.addFlash(15788799, kf * (0.6 + 0.2 * i));
    sx.shake = Math.max(sx.shake, kf * (0.4 + 0.1 * i));
    sx.zoomBlur = Math.max(sx.zoomBlur, kf * 0.5);
  }
  sx.zoomBlur = Math.max(sx.zoomBlur, win4(ct, 228, 230, 254, 256) * 0.4);
  sx.addFlash(0xFFFFFF, win4(ct, 272, 272.15, 272.35, 274) * 1.2);
}
const SevenStarsCover = (ct) => clamp((ct - 58) / 12, 0, 1);                           // SevenStarsPath.cover
/** apply a ScreenFx to one player's lens; W is the current view (screen -> world helper).
 *  fade + shake are THROTTLED (once per event window): stacking a camera.fade every tick is what made the white splash
 *  sit on the screen for seconds instead of flashing for a second like the real firing. */
let LAST_SCREEN = { fade: -999, shake: -999 };
function applyScreenFx(player, sx, W) {
  const now = system.currentTick;
  if (sx.shake > 0.03 && now - LAST_SCREEN.shake > 8) {
    LAST_SCREEN.shake = now;
    tryDo("shake", () => player.runCommand(`camerashake add @s ${Math.min(2.5, sx.shake * 0.9).toFixed(2)} 0.12 rotational`));
  }
  if (sx.flashA > 0.9 && now - LAST_SCREEN.fade > 16) {
    LAST_SCREEN.fade = now;
    tryDo("camera.fade", () => player.camera.fade({ fadeColor: { red: sx.flashC[0], green: sx.flashC[1], blue: sx.flashC[2] }, fadeTime: { fadeInTime: 0.02, holdTime: 0.02, fadeOutTime: 0.15 } }));
  }
  if (W && sx.flashA > 0.04) fxGlow(player.dimension, W.scr(0, 0, 3), 3 * W.tanB * ASPECT * 1.5, LF, sx.flashC, clamp(sx.flashA * 0.8, 0, 0.9), true);
  if (W && sx.bloom > 0.05) fxGlow(player.dimension, W.scr(0, 0, 4), 4 * W.tanB * ASPECT * 1.4, LF, [0.8, 0.84, 1], clamp(sx.bloom * 0.06, 0, 0.14), true);
}

/* ── the virtual camera seen through the Bedrock camera ── */
/** anchor = real camera position; fwdB = real camera facing; vs = virtual shot; fovB = real camera FOV.
 *  A world direction d (virtual frame) is expressed in the virtual camera's axes, then re-expressed in the Bedrock camera's axes, so the
 *  picture is identical whatever roll/FOV the Bedrock camera has. */
function makeView(anchor, fwdB, vs, fovB) {
  const Bb = bedBasis(fwdB), tanB = Math.tan((fovB * RAD) / 2), tanV = Math.tan((vs.fov * RAD) / 2), rho = tanB / tanV;
  const cc = (d) => ({ x: vDot(d, vs.right) * rho, y: vDot(d, vs.up) * rho, z: vDot(d, vs.fwd) });
  const toB = (c) => vAdd(vAdd(vMul(Bb.r, c.x), vMul(Bb.u, c.y)), vMul(Bb.f, c.z));
  return {
    Bb, tanB, rho, anchor,
    dirB: (d) => vNorm(toB(cc(d))),
    at: (d, D) => vAdd(anchor, vMul(vNorm(toB(cc(d))), D)),
    seen: (d, m = 1.2) => { const c = cc(d); return c.z > 0.02 && Math.abs(c.x / c.z) < tanB * ASPECT * m && Math.abs(c.y / c.z) < tanB * m; },
    sz: (tanAng, D) => tanAng * D * rho,                                                // half-extent of a sprite with angular radius atan(tanAng)
    scr: (sx, sy, D) => vAdd(vAdd(vAdd(anchor, vMul(Bb.f, D)), vMul(Bb.r, sx * tanB * D)), vMul(Bb.u, sy * tanB * D)), // screen-space point (units: half screen heights)
  };
}

/** SS-01 (the_shooting_star): dome + space dress. Cloud deck while leaving the atmosphere. */
function cinematicSky(player, cut, pose) {
  if (cut.skill.id === "seven_stars") return;
  const dim = player.dimension, T = cut.subject.target, ct = cut.age, st = DIRECTOR.get(player.id);
  const alt = pose.pos.y - T.y, strong = clamp((alt - 140) / 260, 0, 1);
  const fwd = vNorm(vSub(pose.look, pose.pos));
  const domeA = ramp(ct, 0, 8) * (1 - ramp(ct, 326, 350));
  if (st) st.domeA = domeA;
  skyDome(dim, pose.pos, null, fwd, pose.fov, domeA, ct < 58);
  if (ct >= 44 && ct < 74) cloudDeck(dim, pose.pos, T.y + 30, dimMax(dim) - 70);
  if (ct === 58) fogFade(player);
  if (strong > 0.02) { const f = cut.subject.forward; spaceDress(dim, pose.pos, Math.atan2(f.x, -f.z), strong); }
}

/* ═════════════════════════════ SEVEN STARS — scenes ═════════════════════════════ */
const lockT = (i) => S7.LOCKS + S7.LOCK_STEP * i, fallT = (i) => landTick(i) - 26;
const rightOfDir = (f) => { const r = V(-f.z, 0, f.x); return vLenSq(r) < 1e-6 ? V(1, 0, 0) : vNorm(r); };
/** The figure in the REAL sky (lens stars + links + tags at the true bearings of the 7 stars), `D` blocks around `cam`.
 *  Used for players who watch from the ground and for the ground shots of the cutscene.
 *  From the FINALE on the whole figure RE-FORMS (the firing-cooldown view): stars + links + target brackets, names gone. */
function sevenSkyFigure(sp, t, cam, D, thick) {
  const dim = sp.dim, k = D / 64, Q = [], reformed = t >= S7.FINALE - 6;
  for (let i = 0; i < 7; i++) Q.push(vAdd(cam, vMul(dipperSkyDir(i, sp.turn), D)));
  const shown = (i) => reformed || (t >= lockT(i) && t < fallT(i));
  const named = namedStar(t);
  for (let i = 0; i < 7; i++) {
    if (!shown(i)) continue;
    const boost = t - lockT(i) < 8 ? 1 + (8 - (t - lockT(i))) / 5 : 1;
    const size = (1.5 + (3.4 - DIPPER.MAG[i]) * 0.6) * boost * (thick ? 1.5 : 1) * k;
    fxFlare(dim, Q[i], size, LF, COL.violetHot, 0.8, true);
    fxGlow(dim, Q[i], size * 1.4, LF, thick ? COL.white : COL.violet, 0.3, true);
  }
  if (reformed || t >= lockT(6) + 6) {
    for (const [a, b] of DIPPER.LINKS) {
      if (!shown(a) || !shown(b)) continue;
      const len = vLen(vSub(Q[b], Q[a])), n = Math.max(2, Math.ceil(len / ((thick ? 1.0 : 1.5) * k)));
      for (let q = 1; q < n; q++) fxGlow(dim, vLerp(Q[a], Q[b], q / n), (thick ? 0.6 : 0.32) * k, LF, thick ? COL.white : COL.violet, 0.8, true);
    }
  }
  for (let i = 0; i < 7; i++) {                                             // tags only until that star has fired
    if (!shown(i) || (!reformed && t >= fireT(i))) continue;
    const halfL = D * 0.022, f = vNorm(vSub(Q[i], cam));
    fxLabel(dim, vAdd(Q[i], vMul(rightOfDir(f), halfL * 4 * 0.79)), i, halfL, LF, 0.9, !reformed && i === named);
  }
}
/** radial speed lines from the heading point — thin WHITE line bars, each an OVERLAPPING chain of soft dots (step < dot size),
 *  so a line reads as one continuous bar with no gaps and no "beans". Re-rolled every tick (the shimmer of the original shader). */
function warpLines(dim, W, amount) {
  const n = Math.round(34 * clamp(amount, 0, 1.3) * CFG.fxScale);
  for (let q = 0; q < n; q++) {
    const ang = Math.random() * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
    const r0 = 0.1 + Math.random() * 0.8, len = 0.4 + Math.random() * 0.95;
    const thick = 0.0032 + 0.0034 * Math.random() * (0.65 + amount);          // thin bars
    const steps = Math.max(8, Math.ceil(len / (thick * 0.5)));                 // step = half a dot -> fully connected chain
    const D = 14, sz = thick * W.tanB * D;
    for (let j = 0; j <= steps; j++) {
      const r = r0 + (len * j) / steps, x = ca * r, y = sa * r;
      if (Math.abs(x) > ASPECT * 1.2 || Math.abs(y) > 1.4) break;
      const k = Math.min(1, j / 2) * Math.min(1, (steps - j) / 2 + 0.35);
      fxGlow(dim, W.scr(x, y, D), sz * (0.8 + 0.3 * k), LF, COL.white, clamp((0.5 + 0.4 * k) * amount, 0, 0.95), true);
    }
  }
}
const TOUR_TINT = (i) => (i === 0 ? COL.gold : COL.white);                   // Dubhe = yellow dwarf, the other six = white dwarfs
const RING_COLS = 5, RING_W = 384, RING_H = 192, RING_LOOP = 50, RING_REVEAL = 6;
const ringFrame = (n) => [(n % RING_COLS) * RING_W, Math.floor(n / RING_COLS) * RING_H, RING_W, RING_H];

/** Seven Stars voyage 58 -> 256, rendered from the virtual camera of SevenStarsPath */
function sevenVoyage(sp, p, st) {
  const ct = st.cut.age, dim = sp.dim, turn = sp.turn, vs = sevenShot(ct, turn), G = s4Geom(vs);
  const anchor = st.pos, fwdB = vNorm(vSub(st.look, st.pos)), fovB = st.fovCur ?? vs.fov;
  const W = makeView(anchor, fwdB, vs, fovB), hB = W.tanB, Bb = W.Bb;
  // ── 1. sky: dome (opaque) + cloud deck + the pale cloud fog of the dissolve ──
  const cover = SevenStarsCover(ct);                                       // the world BELOW dissolves with the cover; the sky above stays opaque all the way (no moon)
  st.domeA = 1;
  skyDome(dim, anchor, W.dirB, fwdB, fovB, 1, false, cover);
  if (ct < 74) cloudDeck(dim, anchor, sp.centre.y + 30, dimMax(dim) - 70);
  if (ct === 58) fogFade(p);
  // ── 2. Earth, Moon, Sun (frame 0 and the final approach) ──
  const DE = 34;
  const de = vLen(G.e);
  if (de > 1.002) {
    const rho = Math.asin(1 / de), dir = vMul(G.e, -1 / de);
    if (rho > 0.0006 && rho < 0.95 && W.seen(dir, 1.7)) {
      const pos = W.at(dir, DE), half = W.sz(Math.tan(rho), DE) / 0.86;
      fxGlow(dim, pos, half * 1.2, LF, COL.cyan, 0.2, true);
      fx(dim, FXP.sprite, pos, { size: half, life: LF, color: COL.white, a: 1, atlas: ATLAS.earth, hold: true });
    }
  }
  if (vs.frame === 0) {
    const rel = vSub(SPATH.MOON_E, G.e), dm = vLen(rel), dir = vMul(rel, 1 / dm), rho = Math.asin(Math.min(1, 0.2727 / dm));
    if (rho > 0.0006 && W.seen(dir, 1.5)) fx(dim, FXP.sprite, W.at(dir, DE - 2), { size: W.sz(Math.tan(rho), DE - 2) / 0.9, life: LF, color: COL.white, a: 1, atlas: ATLAS.moon, hold: true });
  }
  {
    const ds = vLen(G.s), dirS = vMul(G.s, -1 / ds);
    if ((vs.frame === 0 || (ct >= 130 && ct < 230)) && W.seen(dirS, 1.5)) {
      const g = vs.frame === 0 ? 0.04 + 0.45 / (1 + ds * 12) : 0.03, pos = W.at(dirS, 38);
      fxFlare(dim, pos, g * hB * 38, LF, COL.pale, 0.85, true);
      fxGlow(dim, pos, g * hB * 38 * 1.8, LF, COL.gold, 0.22, true);
      if (vs.frame === 2) fxLabel(dim, vAdd(pos, vMul(Bb.r, 0.8 * 4 * 0.79)), 7, 0.8, LF, 0.9);   // SOL tag (130-230)
    }
  }
  // ── 3. the seven stars at their true places (parallax from the light-year position of the camera) ──
  const lockA = win4(ct, 66, 72, 88, 96), DF = 36, tags = ct >= 96 && ct < 230;
  if ((ct < 96 && lockA > 0.02) || ct >= 96) {
    const Q = [], seenI = [];
    for (let i = 0; i < 7; i++) {
      const pos = ct >= 200 ? s4ShotAt(ct, i, turn) : s4Star(i, turn), rel = vSub(pos, G.u), d = vLen(rel), dir = vMul(rel, 1 / d);
      seenI.push(W.seen(dir, 1.3)); Q.push(W.at(dir, DF));
      const centred = ct >= 150 && ct < 192 && i === clamp(Math.floor((ct - 150) / 6), 0, 6);
      if (seenI[i] && tags) fxLabel(dim, vAdd(Q[i], vMul(Bb.r, DF * 0.022 * 4 * 0.79)), i, DF * 0.022, LF, 0.9, i === namedStar(ct));
      if (!seenI[i] || centred) continue;   // the centred array star is drawn as a disc below (its tag stays with it)
      const a = ct < 96 ? lockA : 1, boost = ct < 96 ? 1 + (ct < 72 ? (72 - ct) / 8 : 0) : 1;
      const g = (0.014 + 0.011 * (3.4 - DIPPER.MAG[i]) + (ct >= 96 ? 0.12 / (1 + d / 5) : 0.012)) * boost, size = W.sz(g, DF);
      fxFlare(dim, Q[i], size, LF, COL.violetHot, 0.8 * a, true);
      fxGlow(dim, Q[i], size * 1.5, LF, COL.violet, 0.3 * a, true);
    }
    const linkA = ct < 96 ? lockA : (ct >= 192 && ct < 230 ? 1 : 0);
    if (linkA > 0.02) {                                     // the figure's links: while it is locked (SevenStarsPath.lock) and again as it re-forms before the firing
      for (const [a, b] of DIPPER.LINKS) {
        if (!seenI[a] || !seenI[b]) continue;
        const len = vLen(vSub(Q[b], Q[a])), n = Math.max(2, Math.ceil(len / 1.2));
        for (let q = 1; q < n; q++) fxGlow(dim, vLerp(Q[a], Q[b], q / n), 0.2, LF, COL.violet, 0.8 * linkA, true);
      }
    }
    // ── FIRE: the burst ring stays AT the star where it fired (never trails along with it), then the comet needles streak home together ──
    if (ct >= 200 && ct < 262) for (let i = 0; i < 7; i++) {
      const u = (ct - fireT(i)) / 7;
      if (u >= 0 && u <= 1 && ct < 226 && seenI[i]) {
        const s0 = s4Star(i, turn), rel0 = vSub(s0, G.u), d0 = vLen(rel0), dir0 = vMul(rel0, 1 / d0);   // frozen launch point
        if (W.seen(dir0, 1.3)) {
          const e = easeOutExpo(u);
          fxRingView(dim, W.at(dir0, DF), W.sz(0.023 + 0.12 * e, DF), LF, COL.white, 0.85 * (1 - u), true);
          fxFlare(dim, W.at(dir0, DF), W.sz(0.05 * (1 - u) + 0.02, DF), LF, COL.white, 0.9 * (1 - u * 0.6), true);
        }
      }
      if (s4Fired(ct, i) >= 0) {
        for (let j = 18; j >= 0; j--) {                                     // one long thin continuous needle per fired star
          const rel = vSub(s4ShotAt(ct - j * 0.5, i, turn), G.u), dd = vLen(rel), dir = vMul(rel, 1 / dd);
          if (!W.seen(dir, 1.35)) continue;
          const f = 1 - j / 19;
          if (j === 0) { fxFlare(dim, W.at(dir, DF), W.sz(0.045, DF), LF, COL.white, 0.95, true); fxGlow(dim, W.at(dir, DF), W.sz(0.06, DF), LF, COL.violetHot, 0.55, true); }
          else fxGlow(dim, W.at(dir, DF), W.sz(0.011 + 0.012 * f, DF), LF, COL.white, 0.55 + 0.35 * f, true);
        }
      }
    }
  }
  // ── 4. ARRAYS (150-192): the star dead-centre on the crosshair, steady, with the animated cast-ring system around it ──
  if (ct >= 150 && ct < 192) {
    const i = clamp(Math.floor((ct - 150) / 6), 0, 6), aw = s4Awake(ct, i), tint = TOUR_TINT(i), Dd = 24, pos = W.scr(0, 0, Dd);
    const half = (0.17 * hB * Dd) / 0.9;                                    // disc radius = 17 % of half the screen height, the same for every star
    fxGlow(dim, pos, half * 3.2, LF, tint, 0.07 * aw, true);
    fxGlow(dim, pos, half * 1.8, LF, tint, 0.2 * aw, true);
    const reveal = i === 0 && ct - 150 < RING_REVEAL, fr = reveal ? RING_LOOP + Math.floor(ct - 150) : (ct - 150) % RING_LOOP;
    fx(dim, FXP.ringsys, pos, { size: 0.68 * hB * Dd, life: LF, color: COL.white, a: 0.85 * (reveal ? 1 : Math.max(aw, 0.35)), atlas: ringFrame(fr), hold: true });
    fx(dim, FXP.starDisc, pos, { size: half, life: LF, color: COL.white, a: 0.92 * aw, atlas: i === 0 ? [0, 0, 256, 256] : [256, 0, 256, 256], hold: true });
    fxFlare(dim, pos, half * 1.35, LF, tint, 0.14 * aw, true);
  }
  // ── 5. speed lines (SevenStarsPath travel window) + screen fx (SevenStarsFx.filmScreen) ──
  const sx = new ScreenFx();
  filmScreen(sx, ct);
  const travel = Math.max(win4(ct, 84, 100, 124, 130), win4(ct, 226, 230, 254, 257), sx.zoomBlur * 0.7);
  if (travel > 0.02) warpLines(dim, W, travel);
  applyScreenFx(p, sx, W);
}

/** the director's per-tick scene for Seven Stars: the cutscene player gets the voyage; everybody else the figure in the real sky */
function sevenSceneTick(sp, t) {
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== sp.dim.id) continue;
    const st = DIRECTOR.get(p.id);
    if (st && st.pos && st.cut.skill.id === "seven_stars" && st.cut.sp === sp) {
      tryDo("seven-view", () => {
        const ct = st.cut.age;
        if (ct >= 58 && ct < 256) { sevenVoyage(sp, p, st); return; }
        const cam = st.pos, fwd = vNorm(vSub(st.look, st.pos)), fov = st.fovCur ?? 70;
        const domeA = ramp(ct, 0, 8) * (1 - ramp(ct, 256, 280));                       // sky_atlas gone when the fired stars arrive — we are back in the world (Earth)
        st.domeA = domeA;
        skyDome(sp.dim, cam, null, fwd, fov, domeA, true);
        if (ct < 52 || ct >= 256) sevenSkyFigure(sp, ct, cam, 36, ct >= 256);
        if (ct >= 280) {                                    // the burned figure lights the night (stars_world.fsh violet tint):
          for (let i = 0; i < 7; i++) {                     // soft violet glow over every crater + along the burned links
            const n = sp.nodeVec(i);
            if (!chunkReady(sp.dim, n.x, n.z)) continue;
            fxGlow(sp.dim, V(n.x, n.y + 2, n.z), sp.craterR(i) * 1.6, LF, COL.violet, 0.14, true);
            fxGlow(sp.dim, V(n.x, n.y + 7, n.z), 7, LF, COL.violetHot, 0.22, true);
          }
          if (ct >= S7.LINK + 20) for (const [a, b] of DIPPER.LINKS) {
            const A = sp.nodeVec(a), B = sp.nodeVec(b);
            for (let q = 1; q < 8; q++) {
              const p = vLerp(A, B, q / 8);
              if (chunkReady(sp.dim, p.x, p.z)) fxGlow(sp.dim, V(p.x, p.y + 1.5, p.z), 3.2, LF, COL.violet, 0.3, true);
            }
          }
        }
        if (ct >= 44 && ct < 74) cloudDeck(sp.dim, cam, sp.centre.y + 30, dimMax(sp.dim) - 70);
        if (ct >= 256 && ct < 280) { const sx = new ScreenFx(); filmScreen(sx, ct); applyScreenFx(p, sx, null); }
      });
    } else if (!st && hypot2(p.location.x - sp.centre.x, p.location.z - sp.centre.z) < 1200) {
      tryDo("seven-figure", () => sevenSkyFigure(sp, t, p.getHeadLocation(), 64, false));
    }
  }
}

/** Night for the Seven Stars (the figure needs a dark sky): time -> midnight, daylight cycle frozen, restored afterwards */
const NIGHT = { users: 0, saved: null };
const NIGHT_KEY = "shooting_star:night_saved";
function nightBegin() {
  if (!CFG.nightForSeven) return;
  if (NIGHT.users++ > 0) return;
  const saved = { time: tryDo("tod", () => world.getTimeOfDay()) ?? 1000, tick: system.currentTick, cycle: tryDo("rule", () => world.gameRules.doDayLightCycle) !== false };
  NIGHT.saved = saved;
  tryDo("night-save", () => world.setDynamicProperty(NIGHT_KEY, JSON.stringify(saved)));
  tryDo("night", () => world.setTimeOfDay(18000));
  tryDo("night-cycle", () => { world.gameRules.doDayLightCycle = false; });
  tryDo("night-weather", () => world.getDimension("overworld").setWeather("Clear"));
}
function nightRestore(saved) {
  const elapsed = saved.cycle ? system.currentTick - saved.tick : 0;     // the day would have kept running
  tryDo("night-time", () => world.setTimeOfDay((saved.time + elapsed) % 24000));
  tryDo("night-cycle", () => { world.gameRules.doDayLightCycle = saved.cycle; });
  tryDo("night-clear", () => world.setDynamicProperty(NIGHT_KEY, undefined));
}
function nightEnd() {
  if (!CFG.nightForSeven || NIGHT.users === 0) return;
  if (--NIGHT.users > 0 || !NIGHT.saved) return;
  nightRestore(NIGHT.saved); NIGHT.saved = null;
}
system.runTimeout(() => { // a crash during a cast must not leave the world stuck at midnight
  tryDo("night-recover", () => { const raw = world.getDynamicProperty(NIGHT_KEY); if (typeof raw === "string" && NIGHT.users === 0) nightRestore(JSON.parse(raw)); });
}, 80);

/** A beam column drawn as smooth soft vertical bars (fx_beam) — the old beacon-beam billboards were textured sprite strips.
 *  `color` tints the core; `corona` adds the wide transparent white glow pillar around it (star_beam.fsh corona). */
function beamColumn(dim, x, z, y0, y1, rail, color, corona) {
  const step = rail ? 4 : 6, col = color ?? (rail ? COL.laserHot : COL.laser);
  for (let y = y0; y <= y1; y += step) {
    fxBeam(dim, V(x + 0.5, y, z + 0.5), rail ? 1.6 : 2.6, 12, 0.16, col, 0.95);
    if (corona) fxCorona(dim, V(x + 0.5, y, z + 0.5), 10, 22, 0.16, COL.white, 0.16);
  }
}

function shakeAll(dim, intensity, seconds, range, mode = "positional") {
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== dim.id) continue;
    tryDo("camerashake", () => p.runCommand(`camerashake add @s ${intensity} ${seconds} ${mode}`));
  }
}

/** Fill a box. Prefers Dimension.fillBlocks, falls back to /fill. Returns false when the chunk is not loaded. */
/** SpellUtil.breakable — Java skips blocks with hardness < 0 (bedrock, barriers, command blocks...) */
const UNBREAKABLE = ["minecraft:bedrock", "minecraft:barrier", "minecraft:border_block", "minecraft:end_portal", "minecraft:end_portal_frame",
  "minecraft:end_gateway", "minecraft:command_block", "minecraft:chain_command_block", "minecraft:repeating_command_block",
  "minecraft:structure_block", "minecraft:structure_void", "minecraft:jigsaw", "minecraft:light_block_0", "minecraft:allow", "minecraft:deny"];
function fillBox(dim, x0, y0, z0, x1, y1, z1, type) {
  const erasing = type === "minecraft:air";
  try {
    if (mc.BlockVolume && typeof dim.fillBlocks === "function") {
      if (erasing) dim.fillBlocks(new mc.BlockVolume(V(x0, y0, z0), V(x1, y1, z1)), type, { blockFilter: { excludeTypes: UNBREAKABLE } });
      else dim.fillBlocks(new mc.BlockVolume(V(x0, y0, z0), V(x1, y1, z1)), type);
      return true;
    }
  } catch (e) {
    if (String(e).toLowerCase().includes("unloaded")) return false;
  }
  try {
    dim.runCommand(`fill ${x0} ${y0} ${z0} ${x1} ${y1} ${z1} ${type.replace("minecraft:", "")}`);
    return true;
  } catch { return false; }
}
function setType(dim, x, y, z, type) {
  try { const b = dim.getBlock(V(x, y, z)); if (b) { b.setType(type); return true; } } catch { /* unloaded */ }
  return false;
}
function isLoaded(dim, x, z) {
  try { return !!dim.getBlock(V(Math.floor(x), dimMin(dim) + 1, Math.floor(z))); } catch { return false; }
}

const SKIP_GROUND = (id) => id.endsWith("_leaves") || id.endsWith("_log") || id.endsWith("_wood") || id.includes("vine") ||
  id === "minecraft:snow_layer" || id === "minecraft:short_grass" || id === "minecraft:tall_grass" || id === "minecraft:fern";

/**
 * SpellEngine.groundBelow — Y of the first free block above the real ground at (x, z), or null if unloaded.
 * Trees/foliage are skipped so craters measure the ground, not the canopy.
 */
function surfaceAt(dim, x, z) {
  try {
    let b = dim.getTopmostBlock({ x: Math.floor(x), z: Math.floor(z) });
    if (!b) return null;
    for (let i = 0; i < 64 && b && SKIP_GROUND(b.typeId); i++) b = b.below();
    return b ? b.y + 1 : null;
  } catch { return null; }
}

/** SpellEngine.aimGround — ray to the ground (or horizontally into the sky), then snapped DOWN to the terrain. */
function aimGround(player, reach, skyAim) {
  const dim = player.dimension;
  const eye = player.getHeadLocation();
  const dir = player.getViewDirection();
  let hit = null;
  tryDo("raycast", () => {
    const r = player.getBlockFromViewDirection({ maxDistance: reach, includeLiquidBlocks: false });
    if (r && r.block) hit = V(r.block.x + 0.5, r.block.y + 0.5, r.block.z + 0.5);
  });
  let p = hit ?? vAdd(eye, vMul(dir, reach));
  const creature = tryDo("crosshair", () => {
    const list = player.getEntitiesFromViewDirection({ maxDistance: reach });
    for (const r of list) {
      if (r.entity.id === player.id || r.entity.typeId === E_STAR) continue;
      if (r.entity.getComponent("minecraft:health")) return r.entity;
    }
    return undefined;
  });
  if (creature) p = creature.location;
  else if (hit) p = vSub(p, vMul(dir, 0.05));

  if (dir.y >= 0 || !hit && !creature) {
    // looking up / at the sky: aim horizontally "skyAim" blocks ahead, as far as terrain is actually loaded
    let h = V(dir.x, 0, dir.z);
    h = vLenSq(h) < 1e-4 ? V(0, 0, 1) : vNorm(h);
    for (let d = skyAim; d >= 16; d -= 16) {
      const cand = vAdd(eye, vMul(h, d));
      if (isLoaded(dim, cand.x, cand.z) && surfaceAt(dim, cand.x, cand.z) !== null) { p = cand; break; }
      p = cand;
    }
  }
  const gy = surfaceAt(dim, p.x, p.z);
  return V(Math.floor(p.x), gy ?? Math.floor(player.location.y), Math.floor(p.z));
}

/* ───────────────────────────── StarEngine rules ───────────────────────────── */
/** SpellUtil.ward — caster is shielded while the spell runs */
function ward(player) {
  tryDo("ward", () => {
    player.addEffect("resistance", 40, { amplifier: 4, showParticles: false });
    player.addEffect("fire_resistance", 40, { amplifier: 0, showParticles: false });
  });
}

/** SpellUtil.isBoss */
const BOSSES = ["minecraft:ender_dragon", "minecraft:wither", "minecraft:warden", "minecraft:elder_guardian"];
const isBoss = (e) => BOSSES.includes(e.typeId);
/** SpellUtil.affects — living, not an armor stand, not a spectator, not the caster, not the caster's own pet */
function affects(e, caster) {
  if (!valid(e) || e.typeId === E_STAR || e.typeId === "minecraft:armor_stand") return false;
  if (caster && e.id === caster.id) return false;
  if (!tryDo("health", () => e.getComponent("minecraft:health"))) return false;
  if (e.typeId === "minecraft:player" && modeOf(e) === "spectator") return false;
  if (caster && tryDo("tamed", () => { const t = e.getComponent("minecraft:tameable"); return t && t.isTamed && t.tamedToPlayerId === caster.id; })) return false;
  return true;
}
/** SpellUtil.hurt / ModDamageTypes.SHOOTING_STAR */
function hurt(e, attacker, amount) {
  tryDo("hurt", () => e.applyDamage(amount, { cause: "override", ...(attacker && valid(attacker) ? { damagingEntity: attacker } : {}) }));
}
/** star.Erasure.erase — up to 16 lethal blows, then health 0 + death, then discard */
const ERASE_BLOWS = 16, ERASE_WATCH = 400;
const WATCHED = []; // Erasure.Watch { e, attacker, left }
function erase(e, attacker) {
  for (let i = 0; i < ERASE_BLOWS && valid(e); i++) {
    hurt(e, attacker, 1e9);
    if (!valid(e)) break;
    if (tryDo("health0", () => { const h = e.getComponent("minecraft:health"); if (h) h.setCurrentValue(0); return true; })) { /* then die */ }
    tryDo("kill", () => e.kill());
    if (e.typeId === "minecraft:player") break;   // players respawn; never discard them
  }
  if (valid(e) && e.typeId !== "minecraft:player") tryDo("discard", () => e.remove());
}
/** star.Erasure.strike — erase, and keep watching survivors (totems, bosses, respawn tricks) for 400 ticks */
function strike(e, attacker) {
  erase(e, attacker);
  if (valid(e) && !WATCHED.some((w) => w.e === e)) WATCHED.push({ e, attacker, left: ERASE_WATCH });
}
system.runInterval(() => { // Erasure.tick
  for (let i = WATCHED.length - 1; i >= 0; i--) {
    const w = WATCHED[i];
    if (!valid(w.e)) { WATCHED.splice(i, 1); continue; }
    erase(w.e, w.attacker);
    if (--w.left <= 0) { if (valid(w.e) && w.e.typeId !== "minecraft:player") tryDo("discard", () => w.e.remove()); WATCHED.splice(i, 1); }
  }
}, 1);

/** StarEngine.kills — erase every living thing in a full-height cylinder; creative / spectator players are never killed (they are lifted out) */
function eraseEntities(dim, cx, cz, radius, caster) {
  const minY = dimMin(dim), height = dimMax(dim) - minY;
  let list = [];
  try {
    list = dim.getEntities({ location: V(cx - radius, minY, cz - radius), volume: V(radius * 2, height, radius * 2) });
  } catch (e) { warnOnce("getEntities", e); }
  for (const e of list) {
    if (!affects(e, caster)) continue;
    if (hypot2(e.location.x - cx, e.location.z - cz) > radius) continue;
    if (e.typeId === "minecraft:player" && isCreativeOrSpectator(e)) continue;
    if (isBoss(e)) strike(e, caster); else erase(e, caster);
  }
}

/* ── spell.GreaterTeleportation: lift a player out of the blast zone, high up, and let them drift down ── */
const GT = { ALTITUDE: 48, AROUND: 8, TURNS: [0, 20, -20, 40, -40, 60, -60], SLOW_FALL: 0.45, SLOW_FALL_LEAD: 100, SETTLE: 20 };
const GT_HELD = new Map(); // playerId -> { since, until }
function gtHomeward(player, from) {  // direction away from the centre, or where the player is looking
  const l = player.location, h = V(l.x - from.x, 0, l.z - from.z);
  if (vLenSq(h) >= 1) return vNorm(h);
  const yaw = (player.getRotation().y * Math.PI) / 180;
  return V(-Math.sin(yaw), 0, Math.cos(yaw));
}
function gtSky(player, x, z) {      // sky(): 48 blocks above the highest ground around (x, z), over water search +-8
  const dim = player.dimension;
  let ground = surfaceAt(dim, x, z);
  if (ground === null) return null;
  const wet = tryDo("water", () => dim.getBlock(V(Math.floor(x), ground - 1, Math.floor(z))).isLiquid);
  if (wet) for (let dx = -GT.AROUND; dx <= GT.AROUND; dx += 4) for (let dz = -GT.AROUND; dz <= GT.AROUND; dz += 4) ground = Math.max(ground, surfaceAt(dim, x + dx, z + dz) ?? ground);
  const y = Math.min(ground + GT.ALTITUDE, dimMax(dim) - 4);
  return V(Math.floor(x) + 0.5, y, Math.floor(z) + 0.5);
}
function gtDestination(player, from, dist) { // destination(): try the home direction, then fan out 20/40/60 degrees both ways
  const home = gtHomeward(player, from);
  for (const turn of GT.TURNS) {
    const r = (turn * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const d = V(home.x * c - home.z * s, 0, home.x * s + home.z * c);
    const p = gtSky(player, from.x + d.x * dist, from.z + d.z * dist);
    if (p) return p;
  }
  return null;
}
function gtHold(player, ticks) {      // hold(): weightless until they settle (Bedrock has no gravity attribute -> slow falling)
  const now = system.currentTick;
  tryDo("slow_falling", () => player.addEffect("slow_falling", ticks + GT.SLOW_FALL_LEAD, { amplifier: 0, showParticles: false }));
  GT_HELD.set(player.id, { since: now, until: now + ticks + GT.SLOW_FALL_LEAD });
}
function gtLift(player, center, dist) { // lift()
  const to = gtDestination(player, center, dist);
  if (!to) return null;
  const drop = Math.max(0, to.y - (surfaceAt(player.dimension, to.x, to.z) ?? to.y));
  tryDo("lift", () => player.teleport(to, { facingLocation: V(center.x, center.y + 1, center.z), dimension: player.dimension }));
  gtHold(player, Math.ceil(drop * GT.SLOW_FALL));
  return to;
}
system.runInterval(() => { // GreaterTeleportation.tick: release once grounded (after SETTLE) or when time is up
  if (!GT_HELD.size) return;
  const now = system.currentTick;
  for (const p of world.getAllPlayers()) {
    const h = GT_HELD.get(p.id);
    if (!h) continue;
    if (now >= h.until || (p.isOnGround && now - h.since > GT.SETTLE)) { tryDo("slow_falling.remove", () => p.removeEffect("slow_falling")); GT_HELD.delete(p.id); }
  }
}, 2);

/* ───────────────────────────── block palettes (Java used obfuscated block fields) ───────────────────────────── */
function hash2(x, z, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function craterBlock(d, h) {
  if (d < 0.25) return h < 0.5 ? "minecraft:magma" : h < 0.8 ? "minecraft:obsidian" : "minecraft:blackstone";
  if (d < 0.7) return h < 0.35 ? "minecraft:blackstone" : h < 0.55 ? "minecraft:basalt" : h < 0.8 ? "minecraft:deepslate" : "minecraft:smooth_basalt";
  return h < 0.3 ? "minecraft:basalt" : h < 0.55 ? "minecraft:tuff" : h < 0.8 ? "minecraft:deepslate" : "minecraft:coarse_dirt";
}
function trenchBlock(h) {
  return h < 0.3 ? "minecraft:basalt" : h < 0.5 ? "minecraft:blackstone" : h < 0.75 ? "minecraft:smooth_basalt" : "minecraft:deepslate";
}

/* ───────────────────────────── Dipper (star.Dipper, real RA/Dec data) ───────────────────────────── */
const DIPPER = {
  NAMES: ["DUBHE", "MERAK", "PHECDA", "MEGREZ", "ALIOTH", "MIZAR", "ALKAID"],
  GREEK: ["α", "β", "γ", "δ", "ε", "ζ", "η"],
  LY: [123, 79, 83, 81, 83, 83, 104],
  MAG: [1.79, 2.37, 2.44, 3.31, 1.77, 2.23, 1.86],
  RA: [11.0621, 11.0307, 11.8972, 12.2571, 12.9005, 13.3988, 13.7923],
  DEC: [61.7508, 56.3825, 53.6947, 57.0325, 55.9598, 54.9254, 49.3133],
  LINKS: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
};
/** Dipper.flat(): gnomonic projection around the mean RA/Dec, rotated so Dubhe→Alkaid is horizontal, normalised to width 1 */
DIPPER.FLAT = (() => {
  const rad = Math.PI / 180;
  const ra0 = (DIPPER.RA.reduce((a, b) => a + b / 7, 0) * 15) * rad;
  const d0 = (DIPPER.DEC.reduce((a, b) => a + b / 7, 0)) * rad;
  const pts = DIPPER.RA.map((r, i) => {
    const ra = r * 15 * rad, d = DIPPER.DEC[i] * rad;
    const c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(ra - ra0);
    const xi = Math.cos(d) * Math.sin(ra - ra0) / c;
    const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(ra - ra0)) / c;
    return [-xi, -eta];
  });
  const ang = -Math.atan2(pts[6][1] - pts[0][1], pts[6][0] - pts[0][0]);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of pts) {
    const x = p[0] * ca - p[1] * sa, y = p[0] * sa + p[1] * ca;
    p[0] = x; p[1] = y;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX;
  for (const p of pts) { p[0] = (p[0] - (minX + maxX) * 0.5) / w; p[1] = (p[1] - (minY + maxY) * 0.5) / w; }
  return pts;
})();
const dipperNode = (i, turn) => {       // Dipper.node(i, turn) — unscaled, 1440 blocks wide
  const c = Math.cos(turn), s = Math.sin(turn), x = DIPPER.FLAT[i][0] * 1440, y = DIPPER.FLAT[i][1] * 1440;
  return [x * c - y * s, x * s + y * c];
};
const craterRadius = (i) => (16 + (3.4 - DIPPER.MAG[i]) * 12) * 4; // Dipper.craterRadius
const craterDepth = (i) => craterRadius(i) * 0.45;                  // Dipper.craterDepth
const dipperSkyDir = (i, turn) => {                                  // Dipper.skyDir — direction of the real star in the sky
  const n = dipperNode(i, turn), d = Math.sqrt(n[0] * n[0] + 3600 * 3600 + n[1] * n[1]);
  return V(n[0] / d, 3600 / d, n[1] / d);
};

/* ═════════════════════════════ CINEMATIC DIRECTOR (client.cinematic.*) ═════════════════════════════ */
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };                                       // Cutscene.smooth
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);                          // Cutscene.easeInOut (cubic)
const L = (t, a, b) => a + (b - a) * t;                                                                          // StarCutscenes.l

class Pose { // CameraPose
  constructor(pos, look, fov, roll) { this.pos = pos; this.look = look; this.fov = fov; this.roll = roll; }
  lerp(o, t) { return new Pose(vLerp(this.pos, o.pos, t), vLerp(this.look, o.look, t), lerpN(this.fov, o.fov, t), lerpN(this.roll, o.roll, t)); }
}
const pose = (pos, look, fov, roll = 0) => new Pose(pos, look, fov, roll);

class Subject {
  constructor(player, target, forward) { this.player = player; this.target = target; this.forward = forward; }
  feet() { try { const l = this.player.location; return V(l.x, l.y, l.z); } catch { return V(this.target.x, this.target.y, this.target.z); } }
  right() { return V(-this.forward.z, 0, this.forward.x); }
  frame(o, a, b, c) { const r = this.right(), f = this.forward; return V(o.x + r.x * a + f.x * c, o.y + b, o.z + r.z * a + f.z * c); }
  static orbit(p, c, deg) {
    const r = deg * Math.PI / 180, dx = p.x - c.x, dz = p.z - c.z;
    return V(c.x + dx * Math.cos(r) - dz * Math.sin(r), p.y, c.z + dx * Math.sin(r) + dz * Math.cos(r));
  }
}
const homeOf = (S, pt) => { // StarCutscenes.home / SevenStarsCutscenes.home
  const d = vSub(S.feet(), pt), h = V(d.x, 0, d.z);
  return vLenSq(h) < 1 ? vMul(S.forward, -1) : vNorm(h);
};
const sideOf = (h) => V(-h.z, 0, h.x);

class Shot { // Shot.cut / Shot.sweep
  constructor(start, end, blendIn, path) { this.start = start; this.end = end; this.blendIn = blendIn; this.path = path; }
  static cut(s, e, path) { return new Shot(s, e, 0, path); }
  static sweep(s, e, blend, path) { return new Shot(s, e, blend, path); }
}

class Cutscene {
  constructor(subject, skill, shots) {
    this.subject = subject; this.skill = skill; this.shots = shots;
    this.delay = 0; this.fadeIn = 0; /* hardCut() */ this.priority = 2; this.fullFrame = true;
    this.end = shots[shots.length - 1].end + 14;
    this.age = 0; this.skipped = false; this.skipAge = 0;
  }
  time(partial = 0) { return this.age + partial - this.delay; }
  started() { return this.age >= this.delay; }
  finished() { return this.time(0) > this.end || (this.skipped && this.age - this.skipAge > 14); }
  weight(partial = 0) {
    const t = this.time(partial);
    if (t < 0) return 0;
    const fin = this.fadeIn <= 0 ? 1 : smooth(t / this.fadeIn);
    let fout = 1 - smooth((t - (this.end - 14)) / 14);
    if (this.skipped) fout = Math.min(fout, 1 - smooth((this.age + partial - this.skipAge) / 8));
    return Math.max(0, Math.min(fin, fout));
  }
  evaluate(shot, t) {
    const u = clamp((t - shot.start) / Math.max(1, shot.end - shot.start), 0, 1);
    return shot.path(this.subject, easeInOut(u), t);
  }
  pose(partial = 0) {
    const t = this.time(partial);
    let cur = this.shots[0], idx = 0;
    for (let i = 0; i < this.shots.length; i++) if (t >= this.shots[i].start) { cur = this.shots[i]; idx = i; }
    let p = this.evaluate(cur, t);
    if (idx > 0 && cur.blendIn > 0 && t - cur.start < cur.blendIn) {
      const prev = this.evaluate(this.shots[idx - 1], this.shots[idx - 1].end);
      p = prev.lerp(p, smooth((t - cur.start) / cur.blendIn));
    }
    return p;
  }
}

/** Terrain.above — keep the camera above the ground */
function terrainAbove(dim, pos, d) {
  const gy = surfaceAt(dim, pos.x, pos.z);
  return gy === null ? pos : V(pos.x, Math.max(pos.y, gy + d), pos.z);
}
/** SevenStarsCutscenes.near — keep the camera within loading distance of the caster */
function near(S, dim, pt) {
  const f = S.feet(), dx = pt.x - f.x, dz = pt.z - f.z, d = hypot2(dx, dz), max = CFG.cameraMaxDistance;
  const p = d <= max ? pt : V(f.x + dx / d * max, pt.y, f.z + dz / d * max);
  return terrainAbove(dim, p, 2.5);
}

/* ---------- StarCutscenes.theShootingStar : 12 shots, paths read from lambda$theShootingStar$0..11 ---------- */
function shootingStarCutscene(S) {
  const T = S.target;
  const home = () => homeOf(S, T);
  const P = [
    /*0*/ (S, t) => { const f = S.feet(); return pose(S.frame(f, L(t, 1.35, 1.2), L(t, 1.7, 1.6), L(t, 2.1, 1.85)), S.frame(f, 0.36, 1.38, 0.62), 40, 0); },
    /*1*/ (S, t) => { const f = S.feet(); return pose(S.frame(f, 1.1, 2.1, -3.2), vXYZ(T, 0, L(t, 30, 4), 0), L(t, 58, 30), 0); },
    /*2*/ (S, t) => { const H = home(); const c = vXYZ(vAdd(vAdd(T, vMul(H, L(t, 7.5, 6))), vMul(sideOf(H), 2.8)), 0, L(t, 1.0, 1.4), 0);
                      return pose(c, vXYZ(T, 0, L(t * t, 0.3, 24), 0), L(t, 64, 70), L(t, 0, 4)); },
    /*3*/ (S, t) => { const H = home(), h = 6 + 470 * t * t; return pose(vXYZ(vAdd(T, vMul(H, 4 + h * 0.04)), 0, h, 0), T, L(t, 70, 64), 0); },
    /*4*/ (S, t) => { const c = vXYZ(T, 0, 480, 0); return pose(c, vXYZ(vAdd(c, vMul(home(), 10)), 0, 40, 0), 70, 0); },
    /*5*/ (S, t) => { const H = home(); return pose(vXYZ(vAdd(vAdd(T, vMul(H, L(t, 150, 135))), vMul(sideOf(H), 22)), 0, 2.5, 0),
                      vXYZ(T, 0, L(Math.sqrt(t), 330, 30), 0), L(t, 62, 56), L(t, 2, -2)); },
    /*6*/ (S, t) => { const H = home(); return pose(vXYZ(vAdd(vAdd(T, vMul(H, 200 + L(t, 150, 140))), vMul(sideOf(H), 40)), 0, L(t, 150, 138), 0),
                      vXYZ(T, 0, L(t, 70, 90), 0), 84, L(t, -3, 0)); },
    /*7*/ (S, t) => { const H = home(); const p = vXYZ(vAdd(T, vMul(H, 375)), 0, L(t, 95, 175), 0);
                      return pose(Subject.orbit(p, T, L(t, -18, 16)), vXYZ(T, 0, L(t, 130, 230), 0), L(t, 76, 80), 0); },
    /*8*/ (S, t) => { const H = home(); const base = vAdd(T, vMul(H, 216));
                      return pose(vXYZ(vAdd(base, vMul(sideOf(H), L(t, -24, 24))), 0, 4, 0),
                                  vXYZ(vAdd(vAdd(T, vMul(H, 170)), vMul(sideOf(H), L(t, 30, -30))), 0, L(t, 30, 90), 0), 74, L(t, 6, -6)); },
    /*9*/ (S, t) => { const H = home(); return pose(vXYZ(vAdd(vAdd(T, vMul(H, 200 + L(t, 90, 70))), vMul(sideOf(H), 30)), 0, L(t, 300, 270), 0),
                      vXYZ(T, 0, L(t, 40, 0), 0), 72, L(t, 0, 6)); },
    /*10*/(S, t) => { const H = home(); return pose(vXYZ(vAdd(vAdd(T, vMul(H, 200 + L(t, 60, 30))), vMul(sideOf(H), L(t, 20, -10))), 0, L(t, 150, 60), 0),
                      vXYZ(vAdd(T, vMul(H, L(t, 40, 0))), 0, L(t, -40, -110), 0), L(t, 78, 72), 0); },
    /*11*/(S, t) => { const H = home(), f = S.feet(); return pose(vXYZ(vAdd(vAdd(f, vMul(H, L(t, 3.2, 5))), vMul(sideOf(H), L(t, 1.4, 2.2))), 0, L(t, 1.9, 2.8), 0),
                      vXYZ(T, 0, -70, 0), L(t, 64, 72), 0); },
  ];
  const I = SS.IMPACT;
  const shots = [
    Shot.cut(0, 8, P[0]), Shot.cut(8, 30, P[1]), Shot.cut(30, 46, P[2]), Shot.sweep(46, 72, 3, P[3]),
    Shot.cut(72, 342, P[4]), Shot.cut(342, I, P[5]), Shot.cut(I, I + 22, P[6]), Shot.sweep(I + 22, I + 70, 6, P[7]),
    Shot.cut(I + 70, 462, P[8]), Shot.cut(462, 494, P[9]), Shot.sweep(494, 530, 8, P[10]), Shot.sweep(530, 564, 10, P[11]),
  ];
  return new Cutscene(S, SKILLS.the_shooting_star, shots);
}

/* ---------- SevenStarsCutscenes.sevenStars : 22 shots, paths read from lambda$sevenStars$0..10 ---------- */
function sevenStarsCutscene(S, sp) {
  const dim = sp.dim, T = S.target;
  const centre = () => sp.centre;
  const node = (i) => sp.nodeVec(i);
  const nr = (a, b) => near(S, dim, b);
  const home = (pt) => homeOf(S, pt);
  const P0 = (S, t) => { const f = S.feet(); return pose(S.frame(f, L(t, 1.35, 1.2), L(t, 1.7, 1.6), L(t, 2.1, 1.85)), S.frame(f, 0.36, 1.38, 0.62), 40, 0); };
  const P1 = (S, t) => pose(S.frame(S.feet(), 4, L(t, 28, 44), -L(t, 20, 28)), vXYZ(T, 0, -12, 0), L(t, 74, 80), 0);
  const P2 = (S, t) => pose(S.frame(S.feet(), 1.2, 1.9, -1.6), vXYZ(centre(), 0, 3600 * L(t, 0.6, 1.0), 0), L(t, 84, 76), L(t, -4, 6));
  const cdir = vNorm(Array.from({ length: 7 }, (_, i) => dipperSkyDir(i, sp.turn)).reduce((acc, d) => vAdd(acc, d), V()));
  // lens FOV per scene (warp punch, calm, star tour, fire, warp to Earth, re-formed figure)
  const sevenFov = (tk) => (tk < 70 ? 105 : tk < 84 ? L((tk - 70) / 14, 105, 80) : tk < 96 ? 78 : tk < 130 ? L((tk - 96) / 34, 80, 100) : tk < 150 ? 70 : tk < 200 ? 62 : tk < 228 ? 74 : tk < 252 ? L((tk - 228) / 24, 74, 108) : tk < 256 ? 108 : 72);
  const P3 = (S, t, raw) => { const p0 = nr(S, vXYZ(centre(), 0, 20 + 440 * t * t, 0)), p = V(p0.x, Math.min(p0.y, dimMax(sp.dim) - 75), p0.z);
                              const look = vNorm(vLerp(cdir, sevenShot(58, sp.turn).fwd, smooth(((raw ?? 52) - 52) / 6)));
                              return pose(p, vAdd(p, vMul(look, 100)), L(t, 76, 105), 0); };
  // P4 = the Seven Stars space camera (70-256). The Bedrock camera sits on ONE anchor (below the build limit, scenes are particles) and only TURNS
  // along SevenStarsPath.shot(): the sky, Earth, Moon, Sun and the 7 stars are placed from the virtual light-year camera (see sevenVoyage).
  const capY = dimMax(sp.dim) - 75;
  const P4 = (S, t, raw) => {
    const p0 = nr(S, vXYZ(centre(), 0, 460, 0)), pos = V(p0.x, Math.min(p0.y, capY), p0.z);
    const vs = sevenShot(raw, sp.turn), b = smooth((raw - 70) / 10);                   // eases the look from the ascent (figure direction) into the voyage
    const fwd = raw < 80 ? vNorm(vLerp(cdir, vs.fwd, b)) : vs.fwd;
    // Arrays (150-192): the pose is CONSTANT inside each 6-tick star window and JUMPS to the next star — a hard /camera teleport
    // per star (the Java mod never sweeps the camera from star to star). Same for the jump back to the figure at 192 and the
    // parallax jump at 130: hard cuts, no easing turns, no camera-shake feel. The camera holds perfectly still on each star.
    return pose(pos, vAdd(pos, vMul(fwd, 100)), vs.fov + 43 * (1 - b), 0);              // 105 -> calm: the warp punch of the original dissolve
  };
  // P4b = REFORM (256-272): back on the ground, looking up at the re-formed figure from SOL
  const P4b = (S, t) => { const p = S.frame(S.feet(), 1.2, 1.9, -1.6); return pose(p, vAdd(p, vMul(cdir, 100)), 72, 0); };
  const approach = (i) => (S, t) => { // lambda$sevenStars$5(i)
    const n = node(i), H = home(n), R = sp.craterR(i);
    const cam = nr(S, vXYZ(vAdd(vAdd(n, vMul(H, R + 48)), vMul(sideOf(H), 40)), 0, 3, 0));
    const h = 3600 * Math.pow(Math.max(1 - t, 0), 0.75);
    return pose(cam, vXYZ(n, 0, Math.max(h * 0.85, 56), 0), L(t, 72, 66), L(t, 2, -2));
  };
  const impactView = (i) => (S, t) => { // lambda$sevenStars$6(i)
    const n = node(i), H = home(n), R = sp.craterR(i);
    const cam = nr(S, vXYZ(vAdd(vAdd(n, vMul(H, R * 1.25 + 30)), vMul(sideOf(H), -60)), 0, 30 + R * 0.35, 0));
    return pose(cam, vXYZ(n, 0, 24, 0), L(t, 76, 80), L(t, -3, 0));
  };
  const P7 = (S, t) => { const c = centre(), H = home(c); const p = vXYZ(vAdd(c, vMul(H, L(t, 260, 220))), 0, L(t, 150, 180), 0);
                         return pose(nr(S, Subject.orbit(p, c, L(t, -14, 14))), vXYZ(c, 0, -40, 0), 78, 0); };
  const P8 = (S, t) => { const c = centre(), H = home(c);
                         return pose(nr(S, vXYZ(vAdd(vAdd(c, vMul(H, L(t, 300, 260))), vMul(sideOf(H), 80)), 0, L(t, 110, 140), 0)),
                                     vXYZ(c, 0, L(t, 150, 260) * 4, 0), 88, L(t, -3, 3)); };
  const P9 = (S, t) => { const n = node(4), H = home(n), R = sp.craterR(4);
                         return pose(nr(S, vXYZ(vAdd(vAdd(n, vMul(H, R * L(t, 0.8, 0.6))), vMul(sideOf(H), L(t, 30, 50))), 0, L(t, 24, 48), 0)),
                                     vXYZ(n, 0, L(t * t, 10, 220) * 4, 0), L(t, 70, 80), 0); };
  const P10 = (S, t) => { const H = vMul(home(centre()), -1), f = S.feet();
                          return pose(vXYZ(vAdd(vAdd(f, vMul(H, -L(t, 3.2, 5))), vMul(sideOf(H), L(t, 1.4, 2.2))), 0, L(t, 1.9, 2.8), 0),
                                      vXYZ(centre(), 0, 240, 0), L(t, 64, 72), 0); };
  const A = 58, B = 272;
  const shots = [Shot.cut(0, 8, P0), Shot.cut(8, 24, P1), Shot.sweep(24, A - 6, 4, P2), Shot.sweep(A - 6, A + 12, 3, P3), Shot.cut(A + 12, 256, P4), Shot.cut(256, B, P4b)];
  for (let i = 0; i < 7; i++) {
    const lt = landTick(i), st = i === 0 ? B : landTick(i - 1) + 6;
    shots.push(Shot.cut(st, lt, approach(i)));
    shots.push(Shot.cut(lt, i < 6 ? lt + 6 : lt + 10, impactView(i)));
  }
  const after = landTick(6) + 10;
  shots.push(Shot.sweep(after, 440, 4, P7), Shot.cut(440, 476, P8), Shot.sweep(476, 526, 8, P9), Shot.sweep(526, 556, 10, P10));
  const cut = new Cutscene(S, SKILLS.seven_stars, shots);
  cut.sp = sp;
  return cut;
}

/* ---------- CutsceneDirector : applies the pose to the Bedrock camera every tick ---------- */
const DIRECTOR = new Map(); // player.id -> { cut, hud, fov }

function hudHide(player, hide) {
  tryDo("hud", () => {
    if (!player.onScreenDisplay || !mc.HudVisibility) return;
    player.onScreenDisplay.setHudVisibility(hide ? mc.HudVisibility.Hide : mc.HudVisibility.Reset);
  });
}
function inputLock(player, locked) {
  tryDo("inputPermissions", () => {
    if (!player.inputPermissions || !mc.InputPermissionCategory) return;
    player.inputPermissions.setPermissionCategory(mc.InputPermissionCategory.Camera, !locked);
    player.inputPermissions.setPermissionCategory(mc.InputPermissionCategory.Movement, !locked);
  });
}
const CAM_WATCH = new Map(); // playerId -> tick until which we keep making sure the camera is really back to normal
/** Give the camera back: camera.clear() plus the /camera command (either one is enough, both are harmless) */
function releaseCamera(player) {
  tryDo("camera.clear", () => player.camera.clear());
  tryDo("camera.clear-cmd", () => player.runCommand("camera @s clear"));
}
function endCutscene(player) {
  const st = DIRECTOR.get(player.id);
  DIRECTOR.delete(player.id);
  if (!valid(player)) return;
  if (st && st.domeA) skyFadeBegin(player, st.domeA);       // the star dome dissolves slowly: the real sky and the moon fade back in
  releaseCamera(player);
  hudHide(player, false);
  inputLock(player, false);
  CAM_WATCH.set(player.id, system.currentTick + 200);      // watchdog keeps clearing for 10 s in case the engine ignored the first call
  for (const d of [2, 6, 20, 60]) system.runTimeout(() => { if (valid(player) && !DIRECTOR.has(player.id)) releaseCamera(player); }, d);
  if (st) console.warn(`[The Shooting Star] cutscene finished (${st.cut.skill.short}, ${st.cut.age} ticks) — camera released`);
}
function playCutscene(player, cut) {
  if (DIRECTOR.has(player.id)) endCutscene(player);
  CAM_WATCH.delete(player.id);
  DIRECTOR.set(player.id, { cut, hud: false, fov: -1, sneak: !!player.isSneaking, pos: null, errors: 0 });
  inputLock(player, true);
  tryDo("cutscene-title", () => player.onScreenDisplay.setActionBar("§7Sneak §8·§7 skip cutscene"));
}
system.runInterval(() => {
  const now = system.currentTick;
  for (const [id, until] of [...CAM_WATCH.entries()]) {
    const p = world.getAllPlayers().find((x) => x.id === id);
    if (!p || now > until) { CAM_WATCH.delete(id); continue; }
    if (!DIRECTOR.has(id)) releaseCamera(p);
  }
}, 20);
system.afterEvents.scriptEventReceive.subscribe((ev) => { // /scriptevent shooting_star:camera_reset  (run it yourself if the camera ever sticks)
  if (ev.id !== "shooting_star:camera_reset") return;
  const p = ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player" ? ev.sourceEntity : null;
  for (const t of p ? [p] : world.getAllPlayers()) { DIRECTOR.delete(t.id); releaseCamera(t); inputLock(t, false); hudHide(t, false); }
});
function clipPose(dim, p) { // CutsceneDirector.clip — never leave the camera inside a block
  try {
    let pos = p.pos;
    for (let i = 0; i < 48; i++) {
      const b = dim.getBlock(floorV(pos));
      if (!b || !b.isSolid) break;
      pos = vXYZ(pos, 0, 1, 0);
    }
    return pos === p.pos ? p : new Pose(pos, p.look, p.fov, p.roll);
  } catch { return p; }
}
function stepDirector(player, st) {
  const cut = st.cut;
  const sneaking = !!player.isSneaking;
  if (sneaking && !st.sneak && !cut.skipped) { cut.skipped = true; cut.skipAge = cut.age; sfx("ws_info_close"); }
  st.sneak = sneaking;
  cut.age++;
  if (cut.finished()) { endCutscene(player); return; }
  const w = cut.weight(0);
  if (w <= 0.001) return;
  const hide = w > 0.35;
  if (hide !== st.hud) { st.hud = hide; hudHide(player, hide); }
  const raw = cut.pose(0);
  const capY = dimMax(player.dimension) - 75;                       // scenes sit up to ~64 blocks in front of the camera
  const rp = clampSafe(player, raw.pos);
  let p = clipPose(player.dimension, new Pose(V(rp.x, Math.min(rp.y, capY), rp.z), raw.look, raw.fov, raw.roll));
  // CutsceneDirector.apply: blend the real first-person view into the cinematic pose by the fade weight
  const eye = player.getHeadLocation(), view = player.getViewDirection();
  p = new Pose(eye, vAdd(eye, view), p.fov, 0).lerp(p, w);
  if (![p.pos.x, p.pos.y, p.pos.z, p.look.x, p.look.y, p.look.z].every(Number.isFinite)) return; // never hand NaN to the engine
  st.pos = p.pos; st.look = p.look; st.fovCur = p.fov;   // sounds + sky scene follow the camera
  const ez = w > 0.999 && raw.ease ? raw.ease : null;      // Pose.ease: send the camera ONCE with an easing curve, then leave it alone until it arrives
  if (!ez || st.easeKey !== ez.key) {
    st.easeKey = ez ? ez.key : null;
    tryDo("camera.set", () => player.camera.setCamera("minecraft:free", {
      location: p.pos,
      facingLocation: p.look,
      easeOptions: ez ? { easeTime: ez.time, easeType: (mc.EasingType && mc.EasingType[ez.type]) || ez.type }
                      : { easeTime: 0.05, easeType: (mc.EasingType && mc.EasingType.Linear) || "Linear" },
    }));
  }
  if (cut.age % 2 === 0) tryDo("cinematic-hud", () => cinematicHud(player, cut));
  tryDo("sky", () => cinematicSky(player, cut, p));                 // every tick: one copy per tick, never two stale ones
  if (player.camera && typeof player.camera.setFov === "function" && Math.abs(p.fov - st.fov) > 0.4) {
    st.fov = p.fov;
    tryDo("camera.setFov", () => player.camera.setFov({ fov: p.fov, easeOptions: { easeTime: 0.05 } }));
  }
}
function tickDirector() {
  const players = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  for (const [id, st] of [...DIRECTOR.entries()]) {
    const player = players.get(id);
    if (!player || !valid(player)) { DIRECTOR.delete(id); continue; }
    try { stepDirector(player, st); } catch (e) { st.errors++; warnOnce("director", e); }
    // failsafe: an exception every tick, or a cutscene that overstayed, must never keep the camera hostage
    if (DIRECTOR.has(id) && (st.errors > 5 || st.cut.age > st.cut.end + 60)) endCutscene(player);
  }
}
system.runInterval(tickDirector, 1);

/* ═════════════════════════════ SPELL ENGINE (spell.SpellEngine / star.StarEngine) ═════════════════════════════ */
const ACTIVE = new Map(); // casterId:skill -> spell
const COOLDOWN = new Map();
let SPELL_SEQ = 0;

class Spell {
  constructor(skill, caster, target) {
    this.id = ++SPELL_SEQ; this.skill = skill; this.caster = caster; this.casterId = caster.id;
    this.dim = caster.dimension; this.target = target; this.tick = -1;
    this.forward = (() => { const d = caster.getViewDirection(); const h = V(d.x, 0, d.z); return vLenSq(h) < 1e-4 ? V(0, 0, 1) : vNorm(h); })();
    this.spared = null; this.jobs = 0; this.areas = [];
  }
  runJob(gen) {
    this.jobs++;
    const wrapped = (function* (self, g) { try { yield* g; } finally { self.jobs--; } })(this, gen);
    system.runJob(wrapped);
  }
  /** StarEngine.clear/evac: creative + spectator players in the zone are lifted out; a survival caster keeps a spared footing column */
  clearCaster(radius, evacDist) {
    const c = this.caster;
    if (valid(c) && !isCreativeOrSpectator(c) && CFG.railgun.sparePillar) {
      const l = c.location;
      if (hypot2(l.x - this.target.x, l.z - this.target.z) < radius) this.spared = V(Math.floor(l.x), Math.floor(l.y) - 1, Math.floor(l.z));
    }
    for (const p of world.getAllPlayers()) {
      if (p.dimension.id !== this.dim.id || !isCreativeOrSpectator(p)) continue;
      const l = p.location;
      if (hypot2(l.x - this.target.x, l.z - this.target.z) >= radius) continue;
      for (let i = 0; i < 24; i++) particle(this.dim, "minecraft:endrod", V(l.x + (Math.random() - 0.5), l.y + 1 + Math.random(), l.z + (Math.random() - 0.5)));
      if (gtLift(p, this.target, evacDist)) { sfx("star_evac"); p.sendMessage("§a[EVAC] Lifted clear of the strike zone."); }
    }
  }
  isSpared(x, z) { return !!this.spared && this.spared.x === x && this.spared.z === z; }
  onTick() {} onEnd() {}
}

system.runInterval(() => {
  for (const sp of [...ACTIVE.values()]) {
    sp.tick++;
    tryDo(`spell-tick-${sp.skill.id}`, () => sp.onTick(sp.tick));
    if (valid(sp.caster) && sp.tick % 10 === 0) ward(sp.caster);
    if (sp.tick >= sp.skill.duration) {
      tryDo(`spell-end-${sp.skill.id}`, () => sp.onEnd());
      system.runTimeout(() => releaseAreas(sp), 40); // let the last chunk jobs finish first
      ACTIVE.delete(`${sp.casterId}:${sp.skill.id}`);
    }
  }
}, 1);

/* ───────────────────────────── SS-01 : star.ShootingStar ───────────────────────────── */
const beamRadius = (t, R) => (t < SS.IMPACT ? 0 : t < SS.COLLAPSE ? R : R * Math.pow(1 - clamp((t - SS.COLLAPSE) / 24, 0, 1), 1.6));

class ShootingStarSpell extends Spell {
  constructor(caster, target) {
    super(SKILLS.the_shooting_star, caster, target);
    this.R = CFG.railgun.radius;
    this.cs = this.R / SS.RADIUS; // all Java radii are scaled by this
  }
  onTick(t) {
    const { target: T, dim, R } = this;
    const gp = V(T.x + 0.5, T.y, T.z + 0.5);
    switch (t) {
      case 0: addArea(this, T.x, T.z, 4); break;                                  // keep the strike zone loaded + ticking
      case SS.ARMED: sfx("star_arm"); break;
      case SS.PRESS: sfx("star_press"); break;
      case SS.MARK:
        sfx("star_lock");
        castTitle(this);
        if (valid(this.caster)) this.caster.sendMessage(`§4[TARGET LOCKED] §cX ${T.x}  Y ${T.y}  Z ${T.z} — impact in ${Math.round((SS.IMPACT - t) / 20)}s`);
        if (valid(this.caster)) fxEmbers(dim, vXYZ(this.caster.getHeadLocation(), 0, -0.5, 0), 40, 0.25, 0.1, 0.02, 0.13, 0.9, COL.laser); // StarFx: 40 red motes at the remote
        break;
      case 29: sfx("star_countdown"); break;                                       // StarFx COUNTDOWN
      case SS.EVAC: this.clearCaster(R + 3, R + 25); break;
      case 44: sfx("star_ascent"); break;                                          // StarFx: ModSounds.STAR_ASCENT @44
      case 238: sfx("star_gun", { big: true }); break;                             // StarFx: ModSounds.STAR_GUN @238
      case SS.FIRE:
        sfx("star_fire", { big: true });
        flash(dim, [1, 0.2, 0.2], [0.03, 0.05, 0.3], gp, 300);
        fxFlare(dim, vXYZ(gp, 0, 90, 0), 26, 1.6, COL.laserHot);                   // muzzle flash high above the target
        break;
      case SS.IMPACT:
        sfx("star_impact", { big: true }); sfx("star_beam", { big: true });
        particle(dim, P_IMPACT, V(gp.x, T.y + 1, gp.z));
        flash(dim, [1, 0.9, 0.9], [0.02, 0.05, 0.4], gp, 400);                      // composite.fsh Flash
        shakeAll(dim, 1.6, 6, 300);
        fxFlare(dim, vXYZ(gp, 0, 4, 0), Math.max(24, R * 0.9), 2.4, COL.laserHot);
        fxGlow(dim, vXYZ(gp, 0, 3, 0), R * 1.4, 2.8, COL.laser, 0.75);
        fxRing(dim, vXYZ(gp, 0, 0.3, 0), R * 1.2, 2.0, COL.laserHot);
        fxRing(dim, vXYZ(gp, 0, 0.3, 0), R * 2.0, 3.4, COL.laser, 0.7);
        fxEmbers(dim, gp, 90, 6, 14, 6, 1.2, 1.6, COL.pale);
        if (griefing()) this.runJob(this.carve());
        break;
      case SS.COLLAPSE:
        sfx("star_collapse", { big: true });
        flash(dim, [1, 1, 1], [0.02, 0.04, 0.3], gp, 300);
        fxRing(dim, vXYZ(gp, 0, 0.3, 0), R * 1.4, 1.2, COL.white);
        break;
      case SS.GONE:
        break;
      case 490 - 1: sfx("star_after"); break;                                      // StarFx: ModSounds.STAR_AFTER @490
      default: break;
    }
    // MARK .. FIRE: target marker (star_beam laser "Target" pass)
    if (t >= SS.MARK && t < SS.IMPACT && t % 4 === 0) {
      beamColumn(dim, T.x, T.z, T.y, Math.min(dimMax(dim) - 1, T.y + 300), false);
      fxRingStatic(dim, vXYZ(gp, 0, 0.15, 0), 3 + (t % 40) * 0.1, 0.25, COL.laser, 0.9);
      fxFlare(dim, vXYZ(gp, 0, 1.5, 0), 3, 0.25, COL.laserHot, 0.8);
    }
    // FIRE-60 .. FIRE: converging ring (star_rays.fsh)
    if (t > SS.FIRE - 60 && t < SS.FIRE && t % 2 === 0) {
      const k = (t - (SS.FIRE - 60)) / 60;
      fxRingStatic(dim, vXYZ(gp, 0, 0.2, 0), R * (1 - 0.75 * k), 0.15, COL.laser, 0.55 + 0.4 * k);
    }
    // 312..352: red motes rise over the whole strike zone (StarFx.onTick)
    if (t > 312 && t < SS.IMPACT) {
      const n = Math.max(1, Math.round(10 * CFG.fxScale));
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
        const x = T.x + Math.cos(ang) * r, z = T.z + Math.sin(ang) * r, y = surfaceAt(dim, x, z);
        if (y !== null) fx(dim, FXP.ember, V(x, y + 0.5, z), { size: 1.2, life: 0.9, color: COL.laser, a: 0.9, speed: 0.1, rise: 6 });
      }
      if (t % 4 === 0) shakeAll(dim, 0.15, 0.4, 400);
    }
    // IMPACT .. GONE: the beam (StarFx.beamTick + star_beam.fsh)
    if (t >= SS.IMPACT && t < SS.GONE) {
      if ((t - SS.IMPACT) % 2 === 0) {
        const r = beamRadius(t, R);
        beamColumn(dim, T.x, T.z, T.y - 10, Math.min(dimMax(dim) - 1, T.y + 320), true);
        this.burn(r);
        if (r > 0.5) {
          const top = Math.min(dimMax(dim) - 2, T.y + 400);
          for (let y = T.y + 18; y < top; y += 36) fxStreak(dim, V(gp.x, y, gp.z), Math.max(1.5, r * 0.9), 20, 0.16, COL.laserHot, 0.9);
          fxGlow(dim, vXYZ(gp, 0, 6, 0), r * 1.3, 0.16, COL.laser, 0.7);
          fxRingStatic(dim, vXYZ(gp, 0, 0.4, 0), r, 0.12, COL.laserHot, 0.85);
          const ring = Math.max(8, Math.min(24, Math.floor(r / 3)));
          for (let k = 0; k < ring; k++) {
            const ang = k / ring * Math.PI * 2;
            fx(dim, FXP.ember, V(gp.x + Math.cos(ang) * r, T.y + 1, gp.z + Math.sin(ang) * r), { size: 1.1, life: 0.7, color: COL.pale, a: 0.9, speed: 1.2, rise: 10 });
          }
        }
      }
      if ((t - SS.IMPACT) % 10 === 0) shakeAll(dim, 0.9, 1.5, 300);
    }
    if (t === SS.GONE) aftermath(dim, [gp], 800, [[1, 0.6, 0.16], [1, 0.78, 0.29], COL.laser], Math.min(R, 24)); // 800-tick ember glow
  }
  burn(radius) { // ShootingStar.burn — erase everything alive inside the beam
    if (radius <= 0.5) return;
    eraseEntities(this.dim, this.target.x, this.target.z, radius, this.caster);
  }
  /** Carving (throughout): erase a full-height cylinder, centre outward, one chunk-aligned strip at a time */
  *carve() {
    const { dim, target: T, R } = this;
    const yMin = dimMin(dim) + CFG.railgun.keepBottomLayers, yMax = dimMax(dim) - 1;
    const rows = [];
    for (let dz = -R; dz <= R; dz++) rows.push(dz);
    rows.sort((a, b) => Math.abs(a) - Math.abs(b));
    const mod16 = (x) => ((x % 16) + 16) % 16;
    for (const dz of rows) {
      const half = Math.floor(Math.sqrt(R * R - dz * dz)), z = T.z + dz;
      for (let xs = T.x - half; xs <= T.x + half;) {
        const xe = Math.min(T.x + half, xs + 15 - mod16(xs));
        if (this.spared && this.spared.z === z && this.spared.x >= xs && this.spared.x <= xe) {
          if (this.spared.x - 1 >= xs) fillBox(dim, xs, yMin, z, this.spared.x - 1, yMax, z, "minecraft:air");
          if (this.spared.x + 1 <= xe) fillBox(dim, this.spared.x + 1, yMin, z, xe, yMax, z, "minecraft:air");
        } else {
          fillBox(dim, xs, yMin, z, xe, yMax, z, "minecraft:air");
        }
        xs = xe + 1;
      }
      yield;
    }
  }
}

/* ───────────────────────────── SS-04 : star.SevenStars ───────────────────────────── */
class SevenStarsSpell extends Spell {
  constructor(caster, target) {
    super(SKILLS.seven_stars, caster, target);
    const s = CFG.dipper.scale;
    this.s = s;
    // Aim the Dipper so its long axis is perpendicular to the caster's view
    this.turn = Math.atan2(this.forward.x, -this.forward.z);
    this.nodes = []; this.ground = [];
    for (let i = 0; i < 7; i++) {
      const o = dipperNode(i, this.turn);
      const x = Math.floor(target.x + o[0] * s), z = Math.floor(target.z + o[1] * s);
      this.nodes.push([x, z]);
      this.ground.push(surfaceAt(this.dim, x, z) ?? target.y); // ground height AT each star — fixes sky-high craters
    }
    this.centre = (() => {
      let c = V();
      for (let i = 0; i < 7; i++) c = vAdd(c, this.nodeVec(i));
      return vMul(c, 1 / 7);
    })();
    this.extent = Math.max(...this.nodes.map((n, i) => hypot2(n[0] - target.x, n[1] - target.z) + this.craterR(i))) + S7.MARGIN;
    this.stars = new Array(7).fill(null);
  }
  nodeVec(i) { return V(this.nodes[i][0] + 0.5, this.ground[i], this.nodes[i][1] + 0.5); }
  craterR(i) { return craterRadius(i) * this.s; }
  craterD(i) { return craterDepth(i) * this.s; }

  onTick(t) {
    const { dim } = this;
    switch (t) {
      case 0:
        nightBegin();                                         // midnight for the figure
        for (let i = 0; i < 7; i++) { // one ticking area per star (skip when it is already inside another one)
          const [x, z] = this.nodes[i];
          if (!this.areas.some((a) => hypot2(a.x - x, a.z - z) < 16)) addArea(this, x, z, 2);
        }
        break;
      case S7.ARMED: sfx("star_arm"); break;
      case S7.PRESS: sfx("star_press"); break;
      case S7.MARK: sfx("stars_mark"); break;
      case 20: this.clearCaster(this.extent, this.extent + 25); break;
      case 29: sfx("stars_countdown"); break;                    // SevenStarsFx COUNTDOWN
      case 56: sfx("stars_ascent"); break;                       // ModSounds.STARS_ASCENT @56
      case 130: sfx("stars_array"); castTitle(this); break;      // URSA = 130: the title card arrives with the figure
      case 200:
        sfx("stars_fire", { big: true });
        flashFree(dim, COL.violet, [0.03, 0.04, 0.25], this.centre, 400);   // cutscene players get the per-star flashes of filmScreen instead
        break;
      case 228: sfx("stars_return"); break;                      // ModSounds.STARS_RETURN @228
      case S7.FINALE - 6: sfx("stars_finale", { big: true }); break; // FINALE_LEAD = 6
      case S7.FINALE: this.finale(); break;
      case S7.HUM: sfx("stars_hum"); break;                      // HUM = 470
      default: break;
    }
    sevenSceneTick(this, t);                                     // the constellation, voyage, arrays, tags and warp lines (every tick, one copy)
    // 7 locks: LOCKS + LOCK_STEP*i
    for (let i = 0; i < 7; i++) {
      const lt = S7.LOCKS + S7.LOCK_STEP * i;
      if (t === lt) {
        sfx("stars_lock");
        const n = this.nodeVec(i);
        fxRingStatic(dim, V(n.x, n.y + 0.2, n.z), this.craterR(i), 3.0, COL.violet, 0.6);   // crater footprint on the ground
      }
      // the star leaves the constellation: 26-tick ease-in fall along its own sky direction, lands exactly on landTick(i)
      const fallStart = landTick(i) - 26;
      if (t === landTick(i) - 18) sfx("stars_fall");             // SevenStarsFx: STARS_FALL 18 ticks ahead
      if (t >= fallStart && t < landTick(i)) this.dropStar(i, (t - fallStart) / 26);
      if (t === landTick(i)) this.land(i);
      if (t === linkTick(i)) this.burnLink(i);                   // link burn
    }
    if (t === S7.LINK) sfx("stars_link");
    if (t === S7.LINK) flash(dim, COL.violetHot, [0.03, 0.03, 0.22], this.centre, 400);
    if (t === S7.FINALE + 120) aftermath(dim, this.nodes.map((n, i) => V(n[0] + 0.5, this.ground[i], n[1] + 0.5)), 800, [COL.violet, COL.violetHot, COL.cyan], 12);
  }
  /** The star is fired from the constellation: a bright head with ONE long thin continuous white needle behind it
   *  (the PC impact views show a single thin line streaking in — never dotted beans). */
  dropStar(i, u) {
    const { dim } = this, n = this.nodeVec(i), d = dipperSkyDir(i, this.turn), s = 230 * (1 - u * u);
    const head = vAdd(V(n.x, n.y + 1, n.z), vMul(d, s));
    const size = 8 + 5 * u;
    fxFlare(dim, head, size, 0.09, COL.white, 1, true);
    fxGlow(dim, head, size * 1.6, 0.09, COL.violetHot, 0.8, true);
    const run = 46 + 60 * u, steps = 26;                                     // one long thin needle, fully connected
    for (let k = 1; k <= steps; k++) {
      const f = 1 - k / (steps + 1);
      fxGlow(dim, vAdd(head, vMul(d, (k / steps) * run)), 1.4 + 1.6 * f, 0.09, k < 10 ? COL.white : COL.violetHot, 0.85 * f, true);
    }
  }
  land(i) {
    const { dim } = this, n = this.nodeVec(i);
    sfx("stars_land", { big: true });
    particle(dim, P_IMPACT, V(n.x, n.y + 1, n.z));
    flash(dim, COL.violetHot, [0.02, 0.03, 0.2], n, 120);
    shakeAll(dim, 0.8, 1, 150);
    impactTitle(this, i);                                          // "IMPACT 1 · DUBHE" / "α URSAE MAJORIS · 123 LY · CRATER Ø282"
    const R = this.craterR(i);
    fxFlare(dim, V(n.x, n.y + 3, n.z), R * 0.6, 1.6, COL.white);   // SevenStarsFx.landing
    fxGlow(dim, V(n.x, n.y + 2, n.z), R * 0.9, 2.0, COL.violet, 0.8);
    fxRing(dim, V(n.x, n.y + 0.3, n.z), R * 1.1, 1.6, COL.violetHot);
    fxRing(dim, V(n.x, n.y + 0.3, n.z), R * 1.8, 2.6, COL.violet, 0.7);
    fxEmbers(dim, V(n.x, n.y, n.z), 50, 4, 10, 5, 1.0, 1.5, COL.violetHot);  // SevenStarsFx.embers
    eraseEntities(dim, n.x, n.z, R, this.caster);
    if (griefing()) this.runJob(this.crater(i));
  }
  /** star.SevenStars.craterFloor / craterSurface — a bowl measured from the ground height of THIS star */
  *crater(i) {
    const { dim } = this, [nx, nz] = this.nodes[i], R = this.craterR(i), D = this.craterD(i), g = this.ground[i];
    const minY = dimMin(dim) + 1, reach = Math.ceil(R * 1.08) + 1;
    let n = 0;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = nx + dx, z = nz + dz;
        if (this.isSpared(x, z)) continue;
        const px = x + 0.5 - (nx + 0.5), pz = z + 0.5 - (nz + 0.5);
        const dist = Math.hypot(px, pz);
        const edge = R * (1 + 0.07 * Math.sin(Math.atan2(pz, px) * 5 + i));  // wobbly rim
        if (dist > edge) continue;
        const u = dist / edge;
        const floorY = Math.max(Math.floor(g - D * (1 - u * u) * (1 - 0.3 * u * u)), minY);
        let top = null;
        try { const tb = dim.getTopmostBlock({ x, z }); top = tb ? tb.y : null; } catch { continue; }
        if (top === null) continue;
        if (top >= floorY) fillBox(dim, x, floorY, z, x, top, z, "minecraft:air");
        // surface skin: only where solid ground really sits at floorY-1 (never paint floating blocks)
        if (floorY - 1 >= minY && top >= floorY - 1) setType(dim, x, floorY - 1, z, craterBlock(clamp(u + (hash2(x, z, i) - 0.5) * 0.18, 0, 1), hash2(z, x, i + 7)));
        if ((++n & 127) === 0) yield;
      }
    }
    this.placeCore(i);
  }
  /** SevenStars.core — a spiked star_core sitting in the middle of the crater floor */
  placeCore(i) {
    const { dim } = this, [nx, nz] = this.nodes[i];
    const floorY = Math.max(Math.floor(this.ground[i] - this.craterD(i)), dimMin(dim) + 2);
    const put = (x, y, z) => setType(dim, x, y, z, B_CORE);
    for (let y = 0; y < 5; y++) put(nx, floorY + y, nz);
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      put(nx + ax, floorY + 1, nz + az); put(nx + ax * 2, floorY, nz + az * 2);
      if (!this.isSpared(nx + ax, nz + az)) put(nx + ax, floorY, nz + az);
    }
    put(nx, floorY + 5, nz);
  }
  /** SevenStars.againstLink — distance from a column to link i, and how far along it (0..1) */
  against(li, px, pz) {
    const [a, b] = DIPPER.LINKS[li];
    const ax = this.nodes[a][0] + 0.5, az = this.nodes[a][1] + 0.5, bx = this.nodes[b][0] + 0.5, bz = this.nodes[b][1] + 0.5;
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
    return [Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t];
  }
  burnLink(li) {
    if (li >= DIPPER.LINKS.length) return;
    if (griefing()) this.runJob(this.trench(li));
    const [a, b] = DIPPER.LINKS[li], A = this.nodeVec(a), B = this.nodeVec(b);
    const len = hypot2(B.x - A.x, B.z - A.z), steps = Math.max(8, Math.round(len / 3));
    for (let k = 0; k <= S7.LINK_RUN; k++) { // the burn races from star a to star b over LINK_RUN ticks (SevenStarsFx.linkSparks)
      system.runTimeout(() => {
        const lo = k / S7.LINK_RUN, hi = (k + 1) / S7.LINK_RUN;
        for (let j = Math.floor(lo * steps); j <= Math.floor(Math.min(hi, 1) * steps); j++) {
          const p = vLerp(A, B, j / steps);
          if (!chunkReady(this.dim, p.x, p.z)) continue;
          fxBeam(this.dim, V(p.x, p.y + 2, p.z), 1.1, 8, 0.5, COL.violetHot, 0.9);
          fxGlow(this.dim, V(p.x, p.y + 1.5, p.z), 3.2, 0.5, COL.violetHot, 0.9);
          if (j % 3 === 0) fxEmbers(this.dim, V(p.x, p.y + 0.5, p.z), 4, 1.5, 3, 4, 0.8, 1.0, COL.violet);
        }
      }, k);
    }
    const mid = vLerp(A, B, 0.5);
    eraseEntities(this.dim, mid.x, mid.z, len / 2 + S7.TRENCH_W * this.s, this.caster);
  }
  /** SevenStars.linkFloor / linkSurface — trench between two stars, star_trace along the centre line */
  *trench(li) {
    const { dim } = this, [a, b] = DIPPER.LINKS[li], W = S7.TRENCH_W * this.s, D = S7.TRENCH_DEPTH * this.s;
    const x0 = Math.min(this.nodes[a][0], this.nodes[b][0]) - Math.ceil(W) - 1, x1 = Math.max(this.nodes[a][0], this.nodes[b][0]) + Math.ceil(W) + 1;
    const z0 = Math.min(this.nodes[a][1], this.nodes[b][1]) - Math.ceil(W) - 1, z1 = Math.max(this.nodes[a][1], this.nodes[b][1]) + Math.ceil(W) + 1;
    const minY = dimMin(dim) + 1, traceW = Math.max(1.0, 4 * this.s);
    let n = 0;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (this.isSpared(x, z)) continue;
      const [dist, t] = this.against(li, x + 0.5, z + 0.5);
      if (dist > W) continue;
      const base = lerpN(this.ground[a], this.ground[b], t);
      const prof = 1 - (dist / W) * (dist / W);
      const floorY = Math.max(Math.floor(base - D * prof), minY);
      let top = null;
      try { const tb = dim.getTopmostBlock({ x, z }); top = tb ? tb.y : null; } catch { continue; }
      if (top === null) continue;
      if (top >= floorY) fillBox(dim, x, floorY, z, x, top, z, "minecraft:air");
      if (floorY - 1 >= minY && top >= floorY - 1) setType(dim, x, floorY - 1, z, dist < traceW ? B_TRACE : trenchBlock(hash2(x, z, 31 + li)));
      if ((++n & 127) === 0) yield;
    }
  }
  finale() {
    flash(this.dim, COL.white, [0.03, 0.05, 0.35], this.centre, 500);
    shakeAll(this.dim, 1.6, 3, 250);
    for (let i = 0; i < 7; i++) {
      const n = this.nodeVec(i);
      system.runTimeout(() => { // FINALE_BURST: each star flashes in turn
        particle(this.dim, P_IMPACT, V(n.x, n.y + 3, n.z));
        beamColumn(this.dim, this.nodes[i][0], this.nodes[i][1], n.y, Math.min(dimMax(this.dim) - 1, n.y + 200), true, COL.white, true);
        fxFlare(this.dim, V(n.x, n.y + 6, n.z), 22, 1.8, COL.white);
        fxRing(this.dim, V(n.x, n.y + 0.4, n.z), this.craterR(i) * 1.6, 2.2, COL.violetHot);
      }, i * 3);
    }
    // THE BEAM CORONA (star_beam.fsh corona): tall TRANSPARENT white glow pillars over the craters that fade STRAIGHT off
    // over ~2.2 s, revealing the re-formed seven-star constellation in the sky — the firing-cooldown view of the original mod.
    let k = 0;
    const id = system.runInterval(() => {
      const fade = 1 - k / 22;
      if (fade <= 0) { system.clearRun(id); return; }
      for (let i = 0; i < 7; i++) {
        const n = this.nodeVec(i);
        if (!chunkReady(this.dim, n.x, n.z)) continue;
        for (let y = n.y + 6; y < n.y + 130; y += 26) {
          fxCorona(this.dim, V(n.x, y, n.z), 15, 32, 0.15, COL.white, 0.28 * fade);
          fxCorona(this.dim, V(n.x, y, n.z), 5, 32, 0.15, COL.white, 0.38 * fade);
        }
        fxCorona(this.dim, V(n.x, n.y + 4, n.z), 28, 18, 0.15, COL.white, 0.20 * fade);
      }
      k++;
    }, 2);
  }
  onEnd() { nightEnd(); }
}

/* ───────────────────────────── casting (Casting.deny / StarEngine.cast) ───────────────────────────── */
function cooldownLeft(player, skill) {
  const ready = COOLDOWN.get(`${player.id}:${skill.id}`) ?? 0;
  return Math.max(0, ready - system.currentTick);
}
function recharging(player, skill, left) { player.sendMessage(`§c${skill.title} is recharging — ${Math.ceil(left / 20)}s`); sfx("ws_deny", { only: player }); }
function deny(player, msg) { player.sendMessage(`§c[Stellar Remote] ${msg}`); sfx("ws_deny", { only: player }); }

function castSkill(player, skillId) {
  const skill = SKILLS[skillId] ?? SKILLS.the_shooting_star;
  const key = `${player.id}:${skill.id}`;
  if (ACTIVE.has(key)) return deny(player, `${skill.short} is already running.`);
  const left = cooldownLeft(player, skill);
  if (left > 0) return recharging(player, skill, left);

  const spell = skill.id === "seven_stars"
    ? (() => { const tgt = aimGround(player, S7.REACH, S7.SKY_AIM); return new SevenStarsSpell(player, tgt); })()
    : (() => { const tgt = aimGround(player, SS.REACH, SS.SKY_AIM); return new ShootingStarSpell(player, tgt); })();

  COOLDOWN.set(key, system.currentTick + (isCreativeOrSpectator(player) ? CFG.creativeCooldown : (CFG.cooldownTicks[skill.id] ?? 1200)));
  ACTIVE.set(key, spell);

  if (player.getDynamicProperty(CUTSCENE_PROP) ?? true) {
    const subject = new Subject(player, spell.target, spell.forward);
    const cut = skill.id === "seven_stars" ? sevenStarsCutscene(subject, spell) : shootingStarCutscene(subject);
    playCutscene(player, cut);
  }
  player.sendMessage(`${skill.code}★ ${skill.title} §7— ${skill.tier}`);
}

/* ───────────────────────────── item + menu + HUD ───────────────────────────── */
const lastUse = new Map();
function onRemoteUse(player) {
  if (!player) return;
  if (lastUse.get(player.id) === system.currentTick) return; // component + itemUse both fire
  lastUse.set(player.id, system.currentTick);
  if (player.isSneaking) system.run(() => openSkillSelectionMenu(player));
  else {
    const skill = player.getDynamicProperty(SKILL_PROP) || "the_shooting_star";
    system.run(() => castSkill(player, skill));
  }
}
function registerRemoteComponent(ev) {
  tryDo("component-registry", () => {
    ev.itemComponentRegistry.registerCustomComponent("shooting_star_demo:stellar_remote_handler", {
      onUse(e) { onRemoteUse(e.source); },
    });
  });
}
if (system.beforeEvents && system.beforeEvents.startup) system.beforeEvents.startup.subscribe(registerRemoteComponent);
else if (world.beforeEvents && world.beforeEvents.worldInitialize) world.beforeEvents.worldInitialize.subscribe(registerRemoteComponent);

world.afterEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack && ev.itemStack.typeId === "shooting_star_demo:stellar_remote") onRemoteUse(ev.source);
});

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    tryDo("hud", () => {
      const eq = player.getComponent("minecraft:equippable");
      const held = eq && eq.getEquipment("Mainhand");
      if (!held || held.typeId !== "shooting_star_demo:stellar_remote") return;
      const skill = SKILLS[player.getDynamicProperty(SKILL_PROP) || "the_shooting_star"] ?? SKILLS.the_shooting_star;
      if (DIRECTOR.has(player.id)) return;
      const left = cooldownLeft(player, skill);
      const status = ACTIVE.has(`${player.id}:${skill.id}`) ? "§6[CASTING]" : left > 0 ? `§c[RECHARGING ${Math.ceil(left / 20)}s]` : "§a[READY]";
      player.onScreenDisplay.setActionBar(`${skill.code}${skill.short} ${status} §r§7· Sneak+Use: Menu`);
    });
  }
}, 4);


/* ───────────────────────────── Remote tuner (attachable transforms live in player properties) ───────────────────────────── */
const RP = "shooting_star_demo:";
const REMOTE_DEFAULTS = {
  // PC reference (YouTube frames): the remote stands nearly upright — body long axis ~30° from vertical with the top
  // (antenna) leaning LEFT, the labelled face turned to the player. The old rz:0 let the hand roll it ~70° sideways;
  // rz:-95 rolls it back to the PC hold (use the Remote tuner to fine-tune per device).
  fp: { px: 0, py: 0, pz: 0, rx: 140, ry: 180, rz: -95, s: 1.0 },  // first person
  tp: { px: 0, py: 0, pz: 0, rx: 38, ry: 180, rz: -55, s: 0.9 },   // third person
};
const remoteGet = (p, view, k) => { const v = tryDo("prop", () => p.getProperty(`${RP}${view}_${k}`)); return typeof v === "number" ? v : REMOTE_DEFAULTS[view][k]; };
const remoteSet = (p, view, k, v) => tryDo("setProp", () => p.setProperty(`${RP}${view}_${k}`, v));
const REMOTE_CAL = 7;   // bump this when the defaults change: every player is reset once to the new defaults
function applyRemoteDefaults(player, force = false) {
  tryDo("remote-cal", () => {
    if (!force && player.getDynamicProperty("shooting_star:remote_cal") === REMOTE_CAL) return;
    for (const v of ["fp", "tp"]) for (const k of Object.keys(REMOTE_DEFAULTS[v])) remoteSet(player, v, k, REMOTE_DEFAULTS[v][k]);
    player.setDynamicProperty("shooting_star:remote_cal", REMOTE_CAL);
  });
}
const nudge = (p, view, k, d, lo = -360, hi = 360) => { let v = remoteGet(p, view, k) + d; if (v > 180 && k.startsWith("r")) v -= 360; if (v < -180 && k.startsWith("r")) v += 360; remoteSet(p, view, k, clamp(v, lo, hi)); };
/** Quick buttons: every press changes the remote instantly and the menu comes back, so a wrong orientation takes 1-3 taps to fix */
function openRemoteTuner(player, view = "fp") {
  const label = view === "fp" ? "First person" : "Third person";
  const f = (k) => remoteGet(player, view, k);
  new ActionFormData().title(`Remote · ${label}`)
    .body(`§7Hold the remote and look at it while you tap.\n§8tilt ${f("rx")}°  turn ${f("ry")}°  roll ${f("rz")}°  size ${f("s")}`)
    .button("§bTilt back  −15°").button("§bTilt forward  +15°").button("§eFlip upside down")
    .button("§eTurn around (screen ↔ back)").button("§aRoll left  −15°").button("§aRoll right  +15°")
    .button("§fMove up / down…").button("§fSliders…")
    .button(view === "fp" ? "§dEdit third person" : "§dEdit first person").button("§cReset both to default").button("§7Done")
    .show(player).then((r) => {
      if (r.canceled) return;
      const again = () => system.runTimeout(() => openRemoteTuner(player, view), 6);
      switch (r.selection) {
        case 0: nudge(player, view, "rx", -15); again(); break;
        case 1: nudge(player, view, "rx", 15); again(); break;
        case 2: nudge(player, view, "rx", 180); again(); break;
        case 3: nudge(player, view, "ry", 180); again(); break;
        case 4: nudge(player, view, "rz", -15); again(); break;
        case 5: nudge(player, view, "rz", 15); again(); break;
        case 6: tuneView(player, view, label); break;
        case 7: tuneView(player, view, label); break;
        case 8: openRemoteTuner(player, view === "fp" ? "tp" : "fp"); break;
        case 9: applyRemoteDefaults(player, true); player.sendMessage("§a[Remote] Back to the default position."); again(); break;
        default: {
          const g = (v) => Object.keys(REMOTE_DEFAULTS[v]).map((k) => `${k}=${remoteGet(player, v, k)}`).join(" ");
          player.sendMessage(`§b[Remote] first person: §f${g("fp")}\n§a[Remote] third person: §f${g("tp")}`);
        }
      }
    }).catch((e) => warnOnce("tuner-menu", e));
}
function tuneView(player, view, label) {
  const g = (k) => remoteGet(player, view, k);
  new ModalFormData().title(`Remote · ${label}`)
    .slider("Position X (left/right)", -30, 30, { defaultValue: g("px"), valueStep: 0.5 })
    .slider("Position Y (up/down)", -30, 30, { defaultValue: g("py"), valueStep: 0.5 })
    .slider("Position Z (forward/back)", -30, 30, { defaultValue: g("pz"), valueStep: 0.5 })
    .slider("Rotation X (tilt)", -180, 180, { defaultValue: clamp(g("rx"), -180, 180), valueStep: 5 })
    .slider("Rotation Y (turn / flip)", -180, 180, { defaultValue: clamp(g("ry"), -180, 180), valueStep: 5 })
    .slider("Rotation Z (roll)", -180, 180, { defaultValue: clamp(g("rz"), -180, 180), valueStep: 5 })
    .slider("Size", 0.3, 2.5, { defaultValue: g("s"), valueStep: 0.05 })
    .show(player).then((r) => {
      if (r.canceled || !r.formValues) return;
      ["px", "py", "pz", "rx", "ry", "rz", "s"].forEach((k, i) => remoteSet(player, view, k, Number(r.formValues[i])));
      player.sendMessage(`§a[Remote] ${label} saved: ` + ["px", "py", "pz", "rx", "ry", "rz", "s"].map((k, i) => `${k}=${r.formValues[i]}`).join(" "));
      system.runTimeout(() => openRemoteTuner(player, view), 8);
    }).catch((e) => warnOnce("tuner", e));
}

function openSkillSelectionMenu(player) {
  sfx("ws_open", { only: player });
  const active = player.getDynamicProperty(SKILL_PROP) || "the_shooting_star";
  const cuts = player.getDynamicProperty(CUTSCENE_PROP) ?? true;
  const form = new ActionFormData()
    .title("The Shooting Star · Skills")
    .body(`§b[Stellar Remote]\n§7Select the active skill or fire now.\n\n§eActive: ${SKILLS[active].short}\n§7Cooldown: ${Math.round((CFG.cooldownTicks[active] ?? 1200) / 20)}s`)
    .button("§c★ Fire Active Skill Now\n§7Right-click to execute", "textures/items/stellar_remote_icon")
    .button("§e★ SS-01 Railgun\n§7The Shooting Star", "textures/gui/sprites/skill/stellar_remote/the_shooting_star")
    .button("§b✦ SS-04 Seven Stars\n§7Big Dipper constellation", "textures/gui/sprites/skill/stellar_remote/seven_stars")
    .button(cuts ? "§aCamera Cutscenes: [ON]" : "§cCamera Cutscenes: [OFF]", "textures/gui/sprites/skill/stellar_remote/the_shooting_star")
    .button("§eReset Camera\n§7Use this if the view ever sticks")
    .button("§bAdjust Remote Position\n§7First / third person tuner");
  form.show(player).then((r) => {
    if (r.canceled) return;
    if (r.selection === 0) castSkill(player, active);
    else if (r.selection === 1 || r.selection === 2) {
      const id = r.selection === 1 ? "the_shooting_star" : "seven_stars", s = SKILLS[id];
      player.setDynamicProperty(SKILL_PROP, id);
      player.sendMessage(`${s.code}★ Mode set: ${s.short}`);
      sfx("staff_select", { only: player });
      tryDo("title", () => player.onScreenDisplay.setTitle(`${s.code}${s.short.toUpperCase()}`, { subtitle: "§7" + s.title, fadeInDuration: 5, stayDuration: 25, fadeOutDuration: 10 }));
    } else if (r.selection === 3) {
      player.setDynamicProperty(CUTSCENE_PROP, !cuts);
      player.sendMessage(!cuts ? "§a[Camera] Cinematic cutscenes enabled." : "§c[Camera] Cinematic cutscenes disabled.");
      sfx("ws_bound", { only: player });
    } else if (r.selection === 4) {
      DIRECTOR.delete(player.id); releaseCamera(player); inputLock(player, false); hudHide(player, false);
      CAM_WATCH.set(player.id, system.currentTick + 100);
      player.sendMessage("§e[Camera] Reset.");
    } else if (r.selection === 5) {
      system.run(() => openRemoteTuner(player, "fp"));
    }
  }).catch((e) => warnOnce("menu", e));
}

/* ───────────────────────────── safety nets ───────────────────────────── */
world.afterEvents.playerLeave.subscribe((ev) => {
  DIRECTOR.delete(ev.playerId);
});
world.afterEvents.playerSpawn.subscribe((ev) => {
  applyRemoteDefaults(ev.player);
  if (ev.initialSpawn) { inputLock(ev.player, false); hudHide(ev.player, false); }
});
system.runTimeout(() => { for (const p of world.getAllPlayers()) applyRemoteDefaults(p); }, 40);
system.runTimeout(() => { // remove leftover falling stars from a previous crash
  for (const id of ["overworld", "nether", "the_end"]) {
    tryDo("cleanup", () => { for (const e of world.getDimension(id).getEntities({ type: E_STAR })) e.remove(); });
  }
}, 40);

console.warn("[The Shooting Star] BP 1.26.59 loaded — SS-01 Railgun & SS-04 Seven Stars (ported timelines, cutscene director, ground-snapped craters, global sound).");
/* ═════════════════════════════ PORT LEDGER — every one of the 101 Java classes of the mod and where it lives now ═════════════════════════════
 * port    = its logic is now code in this main.js
 * partial = ported, but a part is simplified
 * engine  = replaced by Bedrock itself (JSON in the packs / engine API) — no script code is needed
 * gl      = GPU/shader plumbing: the effects it fed are particles now, so the class has no job left
 * todo    = not ported yet
 * In game: /scriptevent shooting_star:ports   prints the count. */
const PORT_LEDGER = [["ShootingStarDemo","port","world init + item/skill registration"],
  ["EffectProblems","gl","GPU problem screen – not needed (effects are particles)"],
  ["ShootingStarDemoClient","port","tick loops: director, HUD, sky fade"],
  ["cinematic.CameraPose","port","Pose"],
  ["cinematic.Cutscene","port","Cutscene"],
  ["cinematic.CutsceneDirector","port","stepDirector / tickDirector (+ Pose.ease)"],
  ["cinematic.SevenStarsCutscenes","port","sevenStarsCutscene (P4 = SevenStarsPath camera)"],
  ["cinematic.Shot","port","Shot"],
  ["cinematic.Shot$Path","port","Shot"],
  ["cinematic.StarCutscenes","port","shootingStarCutscene"],
  ["cinematic.Subject","port","Subject"],
  ["cinematic.Terrain","port","terrainAbove / near"],
  ["fx.CastTitles","port","castTitle"],
  ["fx.CastTitles$Title","port","castTitle"],
  ["fx.CasterPose","todo","arm pose while casting (needs a player animation controller)"],
  ["fx.Frame","gl","render frame data – not needed"],
  ["fx.FxManager","port","fx* library, fxLabel, shake, flash"],
  ["fx.FxManager$Label","port","fx* library, fxLabel, shake, flash"],
  ["fx.SevenStarsFx","port","sevenSceneTick / sevenVoyage / filmScreen + SevenStarsSpell timeline"],
  ["fx.SevenStarsHud","port","cinematicHud (SS-04 strings, real RANGE readout)"],
  ["fx.SevenStarsPath","port","sevenShot, s4* (voyage geometry, 1:1)"],
  ["fx.SevenStarsPath$Shot","port","sevenShot, s4* (voyage geometry, 1:1)"],
  ["fx.SevenStarsPath$Tag","port","sevenShot, s4* (voyage geometry, 1:1)"],
  ["fx.SpellFx","port","Spell (base class)"],
  ["fx.SpellFx$1","port","Spell (base class)"],
  ["fx.StarFx","partial","ShootingStarSpell + cinematicSky: dome, planets, clouds (deep-space voyage simplified)"],
  ["fx.StarHud","port","cinematicHud (SS-01 strings)"],
  ["fx.StarPath","partial","V maths, pchip, slerp, constants ported; SS-01 galaxy flight simplified"],
  ["fx.StarPath$Cam","port","makeView / V helpers"],
  ["fx.StarPath$Tag","port","makeView / V helpers"],
  ["fx.StarPath$V","port","makeView / V helpers"],
  ["item.RemoteRenderer","engine","stellar_remote attachable + 3D item (RP)"],
  ["item.RemoteRenderer$1","engine","stellar_remote attachable + 3D item (RP)"],
  ["item.RemoteRenderer$Unbaked","engine","stellar_remote attachable + 3D item (RP)"],
  ["magic.ClientSkills","port","selected skill + cooldown state"],
  ["magic.SaoUi","engine","ActionFormData menu replaces the 3D UI"],
  ["magic.SkillArt","engine","skill icons are RP textures"],
  ["magic.SkillHud","port","cooldown action bar"],
  ["magic.SkillKeys","port","Sneak+Use opens the skill menu"],
  ["magic.WhiteSpace","engine","ActionFormData menu replaces the 3D UI"],
  ["magic.WhiteSpace$Info","engine","ActionFormData menu replaces the 3D UI"],
  ["magic.WhiteSpace$State","engine","ActionFormData menu replaces the 3D UI"],
  ["magic.WhiteSpaceMirror","engine","ActionFormData menu replaces the 3D UI"],
  ["magic.WhiteSpaceRenderer","gl","white-space GLSL panel – not needed"],
  ["magic.WhiteSpaceRenderer$1","gl","white-space GLSL panel – not needed"],
  ["magic.WhiteSpaceRenderer$Shard","gl","white-space GLSL panel – not needed"],
  ["magic.WhiteSpaceView","engine","ActionFormData menu replaces the 3D UI"],
  ["magic.WhiteSpaceView$Plate","engine","ActionFormData menu replaces the 3D UI"],
  ["mixin.AvatarPoseMixin","todo","arm pose while casting (needs a player animation controller)"],
  ["mixin.CameraMixin","engine","camera API (/camera)"],
  ["mixin.GameRendererMixin","engine","camera.setFov"],
  ["mixin.GlyphFilterMixin","engine","font in RP"],
  ["mixin.KeyboardHandlerMixin","engine","inputPermissions (camera + movement lock)"],
  ["mixin.KeyboardInputMixin","engine","inputPermissions (camera + movement lock)"],
  ["mixin.LevelRendererMixin","port","skyDome: hides vanilla sky, stars and moon_phases; fades them back"],
  ["mixin.MouseHandlerMixin","engine","inputPermissions (camera + movement lock)"],
  ["mixin.MouseTurnMixin","engine","inputPermissions (camera + movement lock)"],
  ["mixin.PlayerModelPoseMixin","todo","arm pose while casting (needs a player animation controller)"],
  ["render.FxTextures","gl","GL plumbing – effects are particles now"],
  ["render.FxTextures$Decoded","gl","GL plumbing – effects are particles now"],
  ["render.GpuCheck","gl","GPU problem screen – not needed (effects are particles)"],
  ["render.GpuCheck$Result","gl","GPU problem screen – not needed (effects are particles)"],
  ["render.GpuIncompatibleScreen","gl","GPU problem screen – not needed (effects are particles)"],
  ["render.PostFxRenderer","gl","GL plumbing – effects are particles now"],
  ["render.PostFxRenderer$Binder","gl","GL plumbing – effects are particles now"],
  ["render.PostFxRenderer$GlState","gl","GL plumbing – effects are particles now"],
  ["render.PostPass","gl","GL plumbing – effects are particles now"],
  ["render.ScreenFx","port","ScreenFx + applyScreenFx (shake, flash, bloom, zoom-blur)"],
  ["render.ShaderProgram","gl","GL plumbing – effects are particles now"],
  ["render.ShaderWarmup","gl","GL plumbing – effects are particles now"],
  ["render.ShaderWarmupScreen","gl","GL plumbing – effects are particles now"],
  ["render.Uniforms","gl","GL plumbing – effects are particles now"],
  ["magic.Casting","port","castSkill"],
  ["magic.MagicItem","port","remote item component"],
  ["magic.Skill","port","SKILLS"],
  ["magic.SkillSet","port","skill selection (dynamic property + menu)"],
  ["net.CastSkillPayload","engine","item-use event instead of a network packet"],
  ["net.CooldownPayload","engine","item-use event instead of a network packet"],
  ["net.SpellFxPayload","engine","item-use event instead of a network packet"],
  ["registry.ModBlocks","engine","BP JSON (blocks, items, damage)"],
  ["registry.ModDamageTypes","engine","BP JSON (blocks, items, damage)"],
  ["registry.ModItems","engine","BP JSON (blocks, items, damage)"],
  ["registry.ModSkills","port","SKILLS"],
  ["registry.ModSounds","engine","BP JSON (blocks, items, damage)"],
  ["spell.ActiveSpell","port","Spell"],
  ["spell.GreaterTeleportation","port","gt* (greater teleportation)"],
  ["spell.GreaterTeleportation$Hold","port","gt* (greater teleportation)"],
  ["spell.SpellEngine","port","aimGround, ward, hurt, affects"],
  ["spell.SpellUtil","port","aimGround, ward, hurt, affects"],
  ["star.Carving","port","craterBlock / trenchBlock / carve"],
  ["star.Carving$Floor","port","craterBlock / trenchBlock / carve"],
  ["star.Carving$Inside","port","craterBlock / trenchBlock / carve"],
  ["star.Carving$Surface","port","craterBlock / trenchBlock / carve"],
  ["star.Dipper","port","DIPPER"],
  ["star.Erasure","port","erase / eraseEntities"],
  ["star.Erasure$Watch","port","erase / eraseEntities"],
  ["star.SevenStars","port","SevenStarsSpell"],
  ["star.ShootingStar","port","ShootingStarSpell"],
  ["star.StarEngine","port","Spell engine (ACTIVE, ticking)"],
  ["star.StarEngine$1","port","Spell engine (ACTIVE, ticking)"],
  ["star.StarSkill","port","SKILLS / skill rules"]];
function portCounts() {
  const n = { port: 0, partial: 0, engine: 0, gl: 0, todo: 0 };
  for (const r of PORT_LEDGER) n[r[1]]++;
  return n;
}
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "shooting_star:ports") return;
  const n = portCounts(), tot = PORT_LEDGER.length;
  const msg = `§u[The Shooting Star]§r ported to main.js: §a${n.port}/${tot}§r (+${n.partial} partial) · Bedrock-native: ${n.engine} · GPU->particles: ${n.gl} · todo: ${n.todo}`;
  const who = ev.sourceEntity && typeof ev.sourceEntity.sendMessage === "function" ? ev.sourceEntity : null;
  tryDo("ports", () => (who ? who.sendMessage(msg) : world.sendMessage(msg)));
  if (who && ev.message === "list") for (const r of PORT_LEDGER) tryDo("ports-list", () => who.sendMessage(`§7${r[1].padEnd(7)} §f${r[0]} §8${r[2]}`));
});
