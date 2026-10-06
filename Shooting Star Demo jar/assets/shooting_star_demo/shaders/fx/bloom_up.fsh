
uniform vec2 TexelSize;
uniform float Radius;

void main() {
vec2 uv = texCoord;
vec2 ts = TexelSize * Radius;
vec3 s = texture(DiffuseSampler, uv).rgb * 4.0;
s += (texture(DiffuseSampler, uv + ts * vec2(-1, 0)).rgb + texture(DiffuseSampler, uv + ts * vec2(1, 0)).rgb
+ texture(DiffuseSampler, uv + ts * vec2(0, -1)).rgb + texture(DiffuseSampler, uv + ts * vec2(0, 1)).rgb) * 2.0;
s += texture(DiffuseSampler, uv + ts * vec2(-1, -1)).rgb + texture(DiffuseSampler, uv + ts * vec2(1, -1)).rgb
+ texture(DiffuseSampler, uv + ts * vec2(-1, 1)).rgb + texture(DiffuseSampler, uv + ts * vec2(1, 1)).rgb;
fragColor = vec4(s / 16.0 * 0.8 + texture(AuxSampler, uv).rgb, 1.0);
}
