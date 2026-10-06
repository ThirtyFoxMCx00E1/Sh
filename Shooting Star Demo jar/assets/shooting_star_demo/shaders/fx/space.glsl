









vec3 groundGlow(vec3 n);
vec3 airGlow(vec3 p);
#ifdef CLOUD_CUT

float cloudCut(vec3 n);
#endif

const float ATMO = 1.045;
const float SCALE_H = 0.014;
const vec3 SUNLIGHT = vec3(1.0, 0.96, 0.9) * 1.7;
const vec3 UP = vec3(0.0, 1.0, 0.0);
const float NEVER = 1e30;

float gPixel;





bool resolvable(vec3 c, float R) {
return R > length(c) * gPixel * 0.02;
}



vec3 toEarth(vec3 v) {
return vec3(dot(v, EarthX), dot(v, EarthY), dot(v, EarthZ));
}

void tangents(vec3 n, out vec3 east, out vec3 north) {
east = vec3(n.z, 0.0, -n.x);
float l = length(east);
east = l > 1e-4 ? east / l : vec3(1.0, 0.0, 0.0);
north = cross(n, east);
}

vec3 earthSurface(vec3 p, vec3 rd, float t) {
vec3 n = toEarth(normalize(p));
vec3 sun = toEarth(SunDir);
vec3 view = toEarth(rd);
vec2 uv = sphereUV(n);
float arc = gPixel * t / max(dot(-view, n), 0.1);
float lodDay = lodFor(arc, 4096.0);
float lodAux = lodFor(arc, 2048.0);
vec3 albedo = toLinear(textureLod(EarthDay, uv, lodDay).rgb);
vec4 aux = textureLod(EarthAux, uv, lodAux);
float drift = gTime * 0.0012;
float clouds = textureLod(EarthAux, uv + vec2(drift, 0.0), lodAux).g;

float detail = saturate(-lodAux * 0.5);
if (detail > 0.0) {
vec2 fine = uv * vec2(9000.0, 4500.0);
albedo *= mix(1.0, 0.75 + 0.5 * fbm2(fine * 0.5), detail * 0.7);
clouds = saturate(clouds + (fbm2(fine * 0.35 + drift * 900.0) - 0.5) * 0.7 * detail);
aux.r *= mix(1.0, sqr(vnoise2(fine * 1.6)) * 2.2, detail);
}
#ifdef CLOUD_CUT
clouds *= cloudCut(n);
#endif

vec3 east, north;
tangents(n, east, north);
float du = max(exp2(lodAux), 1.0) / 2048.0;
float cosLat = max(sqrt(1.0 - n.y * n.y), 0.05);
float hx = textureLod(EarthAux, uv + vec2(du, 0.0), lodAux).b - textureLod(EarthAux, uv - vec2(du, 0.0), lodAux).b;
float hy = textureLod(EarthAux, uv - vec2(0.0, du * 0.5), lodAux).b - textureLod(EarthAux, uv + vec2(0.0, du * 0.5), lodAux).b;
vec3 nb = normalize(n - (east * hx / cosLat + north * hy * 2.0) * (0.03 / (TAU * du)));

float sunUp = dot(n, sun);
float lit = smoothstep(-0.08, 0.25, sunUp);
float diffuse = max(dot(nb, sun), 0.0) * smoothstep(-0.08, 0.1, sunUp);
float twilight = exp(-sunUp * sunUp / 0.012);
vec3 sunColor = SUNLIGHT * mix(vec3(1.0), vec3(1.0, 0.5, 0.25), twilight * 0.8);
float ocean = (1.0 - smoothstep(0.0, 0.03, aux.b)) * smoothstep(0.0, 0.04, albedo.b - albedo.r);
vec3 h = normalize(sun - view);
float nh = max(dot(n, h), 0.0);
float glint = pow(nh, 400.0) * 0.9 + pow(nh, 30.0) * 0.04;
float fresnel = pow(1.0 - max(dot(n, -view), 0.0), 5.0);
vec3 col = albedo * diffuse * sunColor + ocean * (glint + fresnel * 0.2) * sunColor * lit;
float shadow = textureLod(EarthAux, uv + vec2(drift, 0.0) - vec2(dot(sun, east), -dot(sun, north)) * 0.004, lodAux).g;
col *= 1.0 - shadow * 0.45 * lit;
col = mix(col, sunColor * (max(dot(n, sun), 0.0) * 0.9 + 0.015), clouds * 0.92);
float night = 1.0 - smoothstep(-0.2, 0.04, sunUp);
col += vec3(1.0, 0.68, 0.3) * aux.r * aux.r * 3.2 * night * (1.0 - clouds * 0.75);
col += (albedo + clouds * 0.3) * vec3(0.3, 0.42, 0.75) * 0.08 * night;


return col + groundGlow(n);
}


vec3 atmosphere(vec3 ro, vec3 rd, float tEnd, out vec3 through) {
through = vec3(1.0);
vec2 ha = raySphere(ro, rd, vec3(0.0), ATMO);
if (ha.y <= 0.0) return vec3(0.0);
float t0 = max(ha.x, 0.0);
float t1 = min(ha.y, tEnd);
if (t1 <= t0) return vec3(0.0);
const int STEPS = 12;
float dt = (t1 - t0) / float(STEPS);
vec3 rayleigh = vec3(0.12, 0.32, 1.0) * 30.0;
float mie = 6.0;
float mu = dot(rd, SunDir);
float phaseR = 0.75 * (1.0 + mu * mu);
float g = 0.8;
float phaseM = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08;
vec3 sum = vec3(0.0);
vec3 depth = vec3(0.0);
for (int i = 0; i < STEPS; i++) {
vec3 p = ro + rd * (t0 + dt * (float(i) + 0.5));
float r = length(p);
float dens = exp(-(r - 1.0) / SCALE_H);
depth += (rayleigh + mie) * dens * dt;
float sunUp = dot(p / r, SunDir);
vec3 toSun = exp(-(rayleigh + mie) * SCALE_H * 0.9 / max(sunUp + 0.18, 0.03) * dens * 0.35);
float shade = smoothstep(-0.16, 0.02, sunUp);
sum += dens * dt * exp(-depth) * toSun * shade * (rayleigh * phaseR + mie * phaseM) * SUNLIGHT * 0.6;

sum += dens * dt * exp(-depth) * airGlow(p);
}
through = exp(-depth * 0.7);
return sum;
}

vec3 moonBody(vec3 p, vec3 c, float R, vec3 rd, float t) {
vec3 n = normalize(p - c);

vec3 mz = normalize(EarthRel - c);
vec3 mx = normalize(cross(abs(mz.y) < 0.95 ? UP : vec3(1.0, 0.0, 0.0), mz));
vec3 my = cross(mz, mx);
vec2 uv = sphereUV(vec3(dot(n, mx), dot(n, my), dot(n, mz)));
float arc = gPixel * t / (R * max(dot(-rd, n), 0.1));
vec3 albedo = toLinear(textureLod(MoonColor, uv, lodFor(arc, 4096.0)).rgb);
float ndl = max(dot(n, SunDir), 0.0);
float ndv = max(dot(n, -rd), 0.05);
return albedo * SUNLIGHT * 0.62 * mix(ndl, ndl / (ndl + ndv) * 2.0, 0.4);
}



vec2 atlas(int i, vec2 uv) {
float col = float(i - (i / 2) * 2);
float row = float(i / 2);
return vec2((col + clamp(uv.x, 0.001, 0.999)) * 0.5, (row + clamp(uv.y, 0.002, 0.998)) * 0.25);
}

vec3 sunBody(vec3 p, vec3 c, float R, vec3 rd, float t) {
vec3 n = normalize(p - c);
vec3 ax, ay;
facing(Ecliptic, ax, ay);
vec2 uv = sphereUV(vec3(dot(n, ax), dot(n, Ecliptic), dot(n, ay))) + vec2(gTime * 0.004, 0.0);
float lod = lodFor(gPixel * t / (R * max(dot(-rd, n), 0.1)), 1024.0);
vec3 tex = toLinear(textureLod(Planets, atlas(2, uv), lod).rgb);
float mu = max(dot(n, -rd), 0.0);
return (tex * 1.6 + vec3(0.3, 0.16, 0.05)) * (0.3 + 0.7 * sqrt(mu)) * 70.0;
}


vec3 sunGlare(vec3 rd, vec3 c, float R) {
float dist = length(c);
vec3 dir = c / dist;
float cosA = dot(rd, dir);
if (cosA <= 0.0) return vec3(0.0);
float ang = sqrt(max(2.0 - 2.0 * cosA, 0.0));
float ar = max(R / dist, gPixel * 1.5);
vec3 d = rd - dir * cosA;
float x = dot(d, CamRight);
float y = dot(d, CamUp);
float corona = exp(-(ang - ar) / (ar * 1.2)) * step(ar, ang);
float bloom = ar * ar / (ang * ang + ar * ar) * 0.9;
float streak = exp(-abs(y) / (gPixel * 1.6)) * exp(-abs(x) / 0.35) * min(ar / gPixel, 30.0) * 0.02;
return vec3(1.0, 0.86, 0.66) * (corona * 3.0 + bloom * 4.0) + vec3(1.0, 0.6, 0.45) * streak;
}

vec3 planetBody(int i, vec3 p, vec3 c, float R, vec3 rd, float t) {
vec3 n = normalize(p - c);
vec3 pole = i == 5 ? SaturnPole : Ecliptic;
vec3 ax, ay;
facing(pole, ax, ay);
vec2 uv = sphereUV(vec3(dot(n, ax), dot(n, pole), dot(n, ay))) + vec2(gTime * 0.006 * float(i + 1), 0.0);
float lod = lodFor(gPixel * t / (R * max(dot(-rd, n), 0.1)), 1024.0);
vec3 tex = toLinear(textureLod(Planets, atlas(i, uv), lod).rgb);
vec3 toSun = normalize(SunRelS - c);
float ndl = dot(n, toSun);
vec3 col = tex * SUNLIGHT * max(ndl, 0.0) * 1.1 + tex * 0.003;

float edge = 1.0 - max(dot(n, -rd), 0.0);
float rim = edge * edge * edge * smoothstep(-0.1, 0.4, ndl);
float against = sqr(sqr(max(dot(rd, toSun), 0.0)));
float dusk = sqr(sqr(edge)) * (0.25 + against * 8.0) * smoothstep(-0.6, 0.1, ndl);
return col + tex * rim * 0.4 + (tex * 0.6 + vec3(0.9, 0.7, 0.45)) * dusk;
}


vec4 saturnRings(vec3 rd, vec3 c, float R, float tLimit) {

float t = rayPlane(vec3(0.0), rd, c, SaturnPole);
if (t <= 0.0 || t > tLimit) return vec4(0.0);
vec3 q = rd * t - c;
float r = length(q) / R;
if (r < 1.24 || r > 2.27) return vec4(0.0);
float s = (r - 1.24) / (2.27 - 1.24);
vec3 tex = toLinear(textureLod(Rings, vec2(s, 0.5), log2(max(gPixel * t / R * 400.0 / max(abs(dot(rd, SaturnPole)), 0.05), 1e-3))).rgb);
float a = saturate(max(tex.r, max(tex.g, tex.b)) * 2.2);
vec3 toSun = normalize(SunRelS - c);
vec2 sh = raySphere(q + c, toSun, c, R);
float lit = sh.y > 0.0 ? 0.05 : 1.0;

float forward = sqr(sqr(max(dot(rd, toSun), 0.0)));
return vec4(tex / max(a, 0.05) * SUNLIGHT * lit * (1.2 + 7.0 * forward), a);
}


vec3 orbits(vec3 rd, float tLimit) {
float t = rayPlane(vec3(0.0), rd, SunRelS, Ecliptic);
if (t <= 0.0 || t > tLimit) return vec3(0.0);
float r = length(rd * t - SunRelS);
float w = gPixel * t / max(abs(dot(rd, Ecliptic)), 0.06);
vec3 col = vec3(0.0);
for (int i = 0; i < 8; i++) {
float R = length(Planet[i].xyz - SunRelS);
float d = abs(r - R) / w;
float line = saturate(1.1 - d) + 0.18 * exp(-d / 2.5);
col += (i == 2 ? LASER * 2.2 : HUD_CYAN * 0.5) * line;
}
return col;
}



vec3 panorama(vec3 rd) {
vec3 gx = cross(GalaxyN, ToCentre);
vec3 g = vec3(dot(rd, gx), dot(rd, GalaxyN), dot(rd, ToCentre));
return toLinear(textureLod(MilkyWay, sphereUV(g), lodFor(gPixel, 4096.0)).rgb) * 1.4 + vec3(0.003, 0.005, 0.012);
}

