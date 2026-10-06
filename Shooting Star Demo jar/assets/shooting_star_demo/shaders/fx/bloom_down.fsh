


uniform vec2 TexelSize;
uniform float Prefilter;

uniform float Synthetic;

uniform float MaskAlpha;

vec3 tap(vec2 uv) {
vec4 texel = texture(DiffuseSampler, uv);
vec3 c = texel.rgb;
if (Prefilter > 0.5) {
float synthetic = max(Synthetic, MaskAlpha * (1.0 - texel.a));
vec3 original = texture(AuxSampler, uv).rgb;
vec3 diff = c - original;
vec3 added = max(diff, 0.0);



float lo = min(diff.r, min(diff.g, diff.b));
float hi = max(diff.r, max(diff.g, diff.b));
float additive = lo >= 0.0 ? 1.0 : saturate(1.0 + lo / max(0.1 * hi, 1e-4));
float gained = max(lum(c) - lum(original), 0.0);
added = mix(c * (gained / max(lum(c), 1e-4)), added, additive);
float l = lum(c);
float knee = smoothstep(0.82, 0.98, l);
c = mix(added * 0.55 + c * knee * 0.12, c * smoothstep(0.6, 0.95, l) * 0.4, saturate(synthetic));
}
return c;
}

void main() {
vec2 uv = texCoord;
vec2 ts = TexelSize;
vec3 a = tap(uv + ts * vec2(-2, 2)), b = tap(uv + ts * vec2(0, 2)), c = tap(uv + ts * vec2(2, 2));
vec3 d = tap(uv + ts * vec2(-2, 0)), e = tap(uv), f = tap(uv + ts * vec2(2, 0));
vec3 g = tap(uv + ts * vec2(-2, -2)), h = tap(uv + ts * vec2(0, -2)), i = tap(uv + ts * vec2(2, -2));
vec3 j = tap(uv + ts * vec2(-1, 1)), k = tap(uv + ts * vec2(1, 1));
vec3 l = tap(uv + ts * vec2(-1, -1)), m = tap(uv + ts * vec2(1, -1));
vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
fragColor = vec4(col, 1.0);
}
