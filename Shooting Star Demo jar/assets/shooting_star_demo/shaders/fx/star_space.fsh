














#include "star.glsl"

uniform sampler2D EarthDay;
uniform sampler2D EarthAux;
uniform sampler2D MoonColor;
uniform sampler2D MilkyWay;
uniform sampler2D MilkyTop;
uniform sampler2D Planets;
uniform sampler2D Rings;
uniform vec3 CamFwd;
uniform vec3 CamUp;
uniform vec3 CamRight;
uniform vec3 EarthRel;
uniform vec3 MoonRel;
uniform vec3 SiteRel;
uniform vec3 EarthX;
uniform vec3 EarthY;
uniform vec3 EarthZ;
uniform vec3 SunDir;
uniform vec3 SunRelS;
uniform vec4 Planet[8];
uniform vec3 Ecliptic;
uniform vec3 SaturnPole;
uniform vec3 CentreRel;
uniform vec3 SunRelG;
uniform vec3 GalaxyN;
uniform vec3 ToCentre;
uniform vec3 GunRel;
uniform vec3 ThreadRel;
uniform vec4 S0;
uniform vec4 S1;
uniform vec4 S2;
uniform vec4 S3;
uniform vec4 S4;
uniform vec4 S5;

#include "space.glsl"


vec3 groundGlow(vec3 n) {
vec3 site = vec3(dot(UP, EarthX), dot(UP, EarthY), dot(UP, EarthZ));
float near = length(n - site);
return LASER * (exp(-near / 0.0009) * 2.5 + exp(-near / 0.012) * 0.35)
+ mix(LASER_HOT, vec3(1.0), 0.4) * exp(-near / (0.004 + 0.03 * S3.z)) * S3.z * 6.0;
}



vec3 airGlow(vec3 p) {
float laserWidth = 0.0035 + 0.02 * S3.z;
float along = dot(p, UP);
float off = length(p - UP * along);
float column = step(1.0, along) * exp(-sqr(off / laserWidth));
return column * (LASER * 40.0 * S3.w + mix(LASER, LASER_HOT, 0.5) * S3.z * 900.0);
}







vec3 laserSite() {
return S4.w > 1.5 ? SunRelG : ThreadRel / max(length(ThreadRel), 1e-30);
}





float laserAngle(vec3 rd, vec3 site, float from, out float tRay) {
float height = max(dot(-site, UP), 1e-6);
vec3 a = site + UP * height * from;
float d = raySegmentDist(vec3(0.0), rd, a, site + UP * min(height * 4000.0, S4.x), tRay);
return tRay > 0.0 ? d / tRay : 10.0;
}

vec3 laser(vec3 rd) {
vec3 site = laserSite();
float tRay;
float ang = laserAngle(rd, site, 0.0, tRay);
float core = saturate(1.15 - ang / (gPixel * 0.85));
float glow = exp(-ang / (gPixel * 4.0)) * 0.35 + exp(-ang / (gPixel * 18.0)) * 0.06;
float flicker = 0.85 + 0.15 * sin(gTime * 37.0) * sin(gTime * 23.0 + 1.0);

float spot = length(rd - site / length(site));
vec3 col = LASER * (core * 3.5 + glow) * flicker + LASER_HOT * core * 0.6;
col += (LASER * pointGlow(spot, gPixel, 1.6) * 2.4 + vec3(1.0, 0.6, 0.6) * exp(-sqr(spot / (gPixel * 0.7))) * 0.5)
* (0.8 + 0.2 * sin(gTime * 9.0));
return col * S3.w;
}





vec3 beam(vec3 rd) {
vec3 site = laserSite();
float tRay;
float ang = laserAngle(rd, site, 0.62, tRay);
float core = saturate(1.0 - ang / (gPixel * 1.1));
float sheath = exp(-ang / (gPixel * 2.2)) * 1.2 + exp(-ang / (gPixel * 16.0)) * 0.12;
float height = max(dot(-site, UP), 1e-6);
vec3 head = normalize(site + UP * height * 0.62);
float toHead = length(rd - head);
vec3 col = LASER * (sheath * 3.0 + core * 3.0) + vec3(1.0, 0.9, 0.9) * core * 4.0;

vec3 hd = rd - head * dot(rd, head);
float hx = dot(hd, CamRight);
float hy = dot(hd, CamUp);
float flare = exp(-abs(hy) / (gPixel * 1.1)) * exp(-abs(hx) / 0.35) + exp(-abs(hx) / (gPixel * 1.1)) * exp(-abs(hy) / 0.12);
col += vec3(1.0, 0.92, 0.92) * pointGlow(toHead, gPixel, 2.4) * 6.0 + LASER * (pointGlow(toHead, gPixel, 9.0) * 1.2 + flare * 0.9);
return col;
}


vec3 beacon(vec3 rd) {
vec3 g = normalize(GunRel);
if (dot(rd, g) <= 0.0) return vec3(0.0);
float d = length(rd - g);
float blink = 0.35 + 0.65 * step(0.45, fract(gTime * 1.2));
vec3 off = rd - g * dot(rd, g);
float fx = dot(off, CamRight);
float fy = dot(off, CamUp);
float flare = exp(-abs(fy) / (gPixel * 1.1)) * exp(-abs(fx) / (gPixel * 38.0))
+ exp(-abs(fx) / (gPixel * 1.1)) * exp(-abs(fy) / (gPixel * 22.0));
return (LASER * (pointGlow(d, gPixel, 2.4) * 3.0 + flare * 0.7) * blink + vec3(1.0, 0.85, 0.85) * pointGlow(d, gPixel, 0.9) * 2.4)
* S3.y;
}



const vec3 PAPER = vec3(1.0, 0.97, 0.975);
const vec3 WASH = vec3(0.9, 0.58, 0.63);
const vec3 INK = vec3(0.3, 0.0, 0.035);
const vec3 INK_DEEP = vec3(0.07, 0.0, 0.012);


vec3 inked(float v) {
vec3 col = mix(PAPER, WASH, smoothstep(0.24, 0.42, v) * 0.8);
col = mix(col, INK, smoothstep(0.4, 0.58, v));
return mix(col, INK_DEEP, smoothstep(0.7, 0.88, v) * 0.85);
}






float smear2d(vec2 screen, vec2 vp, float t, out float grain) {
vec2 d = screen - vp;
float r = length(d);
float a = atan(d.x, -d.y);
a += 0.03 * sin(r * 2.4 + t * 5.0);
float along = r * 1.7 - t * 9.0;
float across = a * 9.0;
float strokes = fbm2(vec2(across * 3.4, along * 0.3) + gSeed);
float blots = fbm2(vec2(across * 2.6, along * 2.0) + 41.0 + gSeed);
float fine = fbm2(vec2(across * 12.0, along * 0.45) + 17.0);
grain = fbm2(vec2(across * 3.0, along * 0.4) + 5.0);
return strokes + (blots - 0.48) * 0.55 + (fine - 0.48) * 0.35;
}


float earthInk(vec2 q) {
float r2 = dot(q, q);
if (r2 >= 1.0) return 0.0;
vec3 n = CamRight * q.x + CamUp * q.y - CamFwd * sqrt(1.0 - r2);
vec2 uv = sphereUV(toEarth(n));
vec3 albedo = textureLod(EarthDay, uv, 3.5).rgb;
float clouds = textureLod(EarthAux, uv + vec2(gTime * 0.0012, 0.0), 3.5).g;
float land = 1.0 - smoothstep(0.0, 0.07, albedo.b - albedo.r);
float night = smoothstep(0.12, -0.2, dot(n, SunDir));
return saturate(0.3 + land * 0.5 + night * 0.45 - clouds * 0.6);
}






vec4 inkEarth(vec2 p, vec2 c, float R, float t) {
vec2 d = (p - c) / R;
float r = length(d);
if (r > 1.14) return vec4(0.0);
vec2 dir = r > 1e-4 ? d / r : vec2(0.0, 1.0);
float ink = 0.0;
for (int i = 0; i < 8; i++) {
ink += earthInk(d - dir * float(i) * 0.03 * (0.25 + r));
}
ink /= 8.0;

float a = atan(d.x, -d.y);
float streak = fbm2(vec2(a * 40.0, r * 2.2 - t * 12.0) + gSeed);
float blot = fbm2(vec2(a * 18.0, r * 9.0 - t * 20.0) + 13.0);
ink = saturate(ink + ((streak - 0.5) * 0.6 + (blot - 0.5) * 0.3) * smoothstep(0.05, 0.8, r));
vec3 col = inked(ink);
float rim = smoothstep(0.035, 0.0, abs(r - 1.0) - 0.012);
col = mix(col, INK_DEEP, rim);
float body = 1.0 - smoothstep(0.995, 1.005, r);
float air = smoothstep(1.14, 1.0, r) * (1.0 - body);
return vec4(mix(col, WASH, air * (1.0 - body) * 0.6), max(body, max(rim, air * 0.6)));
}





vec3 beamStroke(vec3 col, vec2 p, vec2 target, float k) {
vec2 from = vec2(-2.6, -1.6);
vec2 dir = normalize(from - target);
vec2 head = target + dir * mix(0.42, 0.035, smoothstep(0.0, 1.0, k));
float d = sdSegment2(p, head, from);
float px = 2.0 / OutSize.y;
col = mix(col, INK_DEEP, 1.0 - smoothstep(px * 4.0, px * 5.2, d));
col = mix(col, vec3(1.0, 0.1, 0.14), 1.0 - smoothstep(px * 2.4, px * 3.3, d));
col = mix(col, vec3(1.0, 0.96, 0.96), 1.0 - smoothstep(px * 0.6, px * 1.3, d));

vec2 g = p - head;
float twinkle = 0.8 + 0.2 * sin(gTime * 60.0);
float len = (0.1 + 0.18 * k) * twinkle;
float star = exp(-abs(g.y) / (px * 1.2)) * exp(-abs(g.x) / len) + exp(-abs(g.x) / (px * 1.2)) * exp(-abs(g.y) / len);
float core = exp(-dot(g, g) / sqr(px * 5.0));
col = mix(col, vec3(1.0, 0.1, 0.14), saturate(star * 1.5));
return mix(col, vec3(1.0), saturate(core * 1.6));
}



void main() {
gTime = S0.y;
gSeed = S0.z;
float tanFov = S0.x;
gPixel = 2.0 * tanFov / OutSize.y;
gPix = gPixel;
vec2 ndc = texCoord * 2.0 - 1.0;
vec2 screen = vec2(ndc.x * OutSize.x / OutSize.y, ndc.y);
vec3 rd = normalize(CamFwd + (CamRight * screen.x + CamUp * screen.y) * tanFov);
float chase = S2.y;


float inside = 1.0 - S1.w;
vec3 col = panorama(rd) * inside;
col += starField(rd, gPixel, inside * 0.45 + 0.2 * (1.0 - chase));
col += deepField(rd, gPixel) * (1.0 - inside) * (1.0 - 0.6 * chase);



if (S2.x > 0.001) {
vec3 heading = chase > 0.5 ? -UP : normalize(GunRel);
float phase = gTime * (chase > 0.5 ? 11.0 : 2.2);
vec3 tintA = chase > 0.5 ? vec3(1.0, 0.16, 0.2) : vec3(0.75, 0.82, 1.0);
vec3 tintB = chase > 0.5 ? vec3(1.0, 0.9, 0.88) : vec3(1.0, 0.85, 0.65);
col += warpField(rd, heading, phase, chase > 0.5 ? 2.6 : 0.05, gPixel, tintA, tintB) * S2.x * (chase > 0.5 ? 0.9 : 0.7);
}


float cover;
float tDisc;
vec3 mw = galaxyDisc(rd, CentreRel, GalaxyN, ToCentre, 60.0, MilkyTop, gPixel, NEVER, cover, tDisc);
float mwShow = S1.z * S1.w;
float tb;
float db = rayPointDist(vec3(0.0), rd, CentreRel, tb);
float bulge = tb > 0.0 ? exp(-sqr(db / 4.5)) : 0.0;
col = col * (1.0 - cover * 0.85 * mwShow) + (mw * 0.62 + vec3(1.0, 0.82, 0.55) * bulge * 0.22) * mwShow;

float sunG = length(rd - normalize(SunRelG));
col += vec3(1.0, 0.9, 0.75) * pointGlow(sunG, gPixel, 1.3) * 3.0 * S1.z;
col += beacon(rd);


float tSolid = NEVER;
vec3 solid = vec3(0.0);
bool solar = length(SunRelS) < 4000.0;
vec2 hs = solar && resolvable(SunRelS, S3.x) ? raySphere(vec3(0.0), rd, SunRelS, S3.x) : vec2(-1.0);
if (hs.x > 0.0) {
tSolid = hs.x;
solid = sunBody(rd * hs.x, SunRelS, S3.x, rd, hs.x);
}
for (int i = 0; i < 8; i++) {
if (!solar) break;
if (i == 2) continue;
vec3 c = Planet[i].xyz;
float R = Planet[i].w;
vec2 h = resolvable(c, R) ? raySphere(vec3(0.0), rd, c, R) : vec2(-1.0);
if (h.x > 0.0 && h.x < tSolid) {
tSolid = h.x;
solid = planetBody(i, rd * h.x, c, R, rd, h.x);
} else if (h.x <= 0.0) {

float d = length(rd - normalize(c));
float lit = 0.5 + 0.5 * dot(normalize(c - SunRelS), normalize(-c));
col += vec3(1.0, 0.95, 0.85) * pointGlow(d, gPixel, 1.1) * (0.5 + lit) * 0.9 * (1.0 - S1.x);
}
}

if (solar) {
float earthDot = length(rd - normalize(Planet[2].xyz));
col += vec3(0.55, 0.75, 1.0) * pointGlow(earthDot, gPixel, 1.2) * 1.4 * (1.0 - S1.x);
}
if (tSolid < NEVER) {
col = solid;
}
vec4 ring = solar && resolvable(Planet[5].xyz, Planet[5].w * 2.3) ? saturnRings(rd, Planet[5].xyz, Planet[5].w, tSolid)
: vec4(0.0);
if (ring.a > 0.0) {
float front = rayPlane(vec3(0.0), rd, Planet[5].xyz, SaturnPole);
col = mix(col, ring.rgb, ring.a * (front < tSolid ? 1.0 : 0.0));
}
if (S1.y > 0.001 && solar) {
col += orbits(rd, tSolid) * S1.y;
}
if (solar) {
col += sunGlare(rd, SunRelS, S3.x) * (1.0 - S1.x * 0.9);
}


if (S1.x > 0.001) {
vec3 ro = -EarthRel;
vec2 he = raySphere(ro, rd, vec3(0.0), 1.0);
vec2 hm = raySphere(vec3(0.0), rd, MoonRel, S2.w);
float tEarth = he.x > 0.0 ? he.x : NEVER;
float tMoon = hm.x > 0.0 ? hm.x : NEVER;
vec3 near = col;
if (tMoon < tEarth) {
near = moonBody(rd * tMoon, MoonRel, S2.w, rd, tMoon);
} else if (tEarth < NEVER) {
near = earthSurface(ro + rd * tEarth, rd, tEarth);
}
vec3 through;
vec3 air = atmosphere(ro, rd, min(tEarth, tMoon), through);
near = near * through + air;
col = mix(col, near, S1.x);
}


col += chase > 0.5 ? beam(rd) : laser(rd);
if (chase > 0.5) {

float edge = smoothstep(0.9, 1.7, length(screen));
col += LASER * edge * 0.4 * S3.z;
}


col = 1.0 - exp(-col * 1.1);
col = pow(col, vec3(1.0 / 2.2));



float dis = S2.z;
float cover0 = S0.w;
float fog = sin(saturate(dis) * PI) * (1.0 - chase);
float mask = 1.0;
vec3 outCol = col;
if (cover0 < 0.999 || fog > 0.001) {
vec3 world = texture(DiffuseSampler, texCoord).rgb;
float r = length(screen);
float ang = atan(screen.y, screen.x);
float wisps = fbm2(vec2(ang * 2.5, log(r + 0.03) * 2.2 - dis * 7.0) + gSeed);
mask = smoothstep(wisps - 0.12, wisps + 0.12, cover0 * 1.35 - 0.2);
outCol = mix(world, col, mask);
float cloud = smoothstep(0.35, 0.8, fbm2(screen * 2.2 + vec2(0.0, -dis * 5.0) + wisps));
outCol = mix(outCol, vec3(0.92, 0.94, 1.0), fog * (0.35 + 0.65 * cloud) * 0.95);
}



if (S4.z > 0.001) {
float t = floor(gTime * 12.0) / 12.0;
vec2 shakeOn2s = (vec2(hash11(t * 7.13), hash11(t * 3.31)) - 0.5) * 0.014;
vec2 p = screen + shakeOn2s;
float dist = max(length(EarthRel), 1.0001);
float R = tan(asin(1.0 / dist)) / tanFov;
vec4 earth = inkEarth(p, vec2(0.0), R, t);

float grain;
vec3 flat2d = earth.rgb;
if (earth.a < 0.999) {
flat2d = mix(inked(smear2d(p, vec2(0.0), t, grain)), earth.rgb, earth.a);
} else {
vec2 d = p;
grain = fbm2(vec2(atan(d.x, -d.y) * 27.0, (length(d) * 1.7 - t * 9.0) * 0.4) + 5.0);
}
flat2d = beamStroke(flat2d, p, vec2(0.0), S5.x);
float take = smoothstep(grain - 0.1, grain + 0.1, S4.z * 1.25 - 0.1);
outCol = mix(outCol, flat2d, take);
}
fragColor = vec4(outCol, 1.0 - mask);
}
