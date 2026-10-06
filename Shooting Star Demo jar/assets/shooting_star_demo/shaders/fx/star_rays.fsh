







#include "star.glsl"

uniform vec3 CamPos;
uniform vec3 CamFwd;
uniform vec3 CamUp;
uniform vec3 CamRight;
uniform vec3 KeyDir;
uniform vec3 Muzzle;
uniform vec4 R0;


vec3 onScreen(vec3 dir) {
float z = dot(dir, CamFwd);
if (z <= 0.02) return vec3(0.0, 0.0, -1.0);
vec2 s = vec2(dot(dir, CamRight), dot(dir, CamUp)) / (z * R0.x);
return vec3(s.x * OutSize.y / OutSize.x * 0.5 + 0.5, s.y * 0.5 + 0.5, 1.0);
}


vec3 shafts(vec2 light, float reach, float threshold, float decay) {
vec2 delta = (light - texCoord) * reach / 40.0;
vec2 uv = texCoord;
vec3 sum = vec3(0.0);
float w = 1.0;
float jitter = hash12(texCoord * OutSize);
uv += delta * jitter;
for (int i = 0; i < 40; i++) {
uv += delta;
if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
vec4 s = texture(DiffuseSampler, uv);
float bright = max(lum(s.rgb) - threshold, 0.0) / (1.0 - threshold);
sum += s.rgb * bright * s.a * w;
w *= decay;
}
return sum / 40.0;
}

void main() {
vec4 base = texture(DiffuseSampler, texCoord);
vec3 col = base.rgb;

if (R0.y > 0.001) {
vec3 key = onScreen(normalize(KeyDir));
if (key.z > 0.0) {
col += shafts(key.xy, 1.0, 0.42, 0.985) * vec3(1.0, 0.86, 0.7) * 2.4 * R0.y;
}
}

float power = R0.z * 3.0 + R0.w * R0.w * 1.4;
if (power > 0.001) {
vec3 m = onScreen(normalize(Muzzle - CamPos));
if (m.z > 0.0) {
vec3 rays = shafts(m.xy, mix(0.35, 1.0, R0.z), 0.35, mix(0.9, 0.97, R0.z));
col += rays * mix(vec3(1.0, 0.25, 0.28), vec3(1.0, 0.9, 0.9), R0.z) * power;
}
}
fragColor = vec4(col, 0.0);
}
