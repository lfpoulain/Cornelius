#include <metal_stdlib>
using namespace metal;
struct Uniforms { float4 clock; float4 color; float4 accent; float4 layout; float4 motion; };
struct VertexOut { float4 position [[position]]; float3 normal; float3 surface; float2 uv; };
float3 deform(float3 p, constant Uniforms& u) {
    float time=u.clock.x, energy=u.clock.y, speech=u.clock.z, twist=u.motion.x, flow=u.motion.y;
    float waves=sin(p.x*3.1+time*.65)*sin(p.y*2.7-time*.48)+.5*sin(p.z*3.5+p.y*1.8+time*.55);
    p*=1.0+waves*(.055+energy*.035)+speech*.07*sin(p.y*4.0+time*2.0);
    float angle=twist*(p.y*.95+sin(p.y*2.3-flow)*.32);
    p.xz=float2x2(cos(angle),-sin(angle),sin(angle),cos(angle))*p.xz;
    p.x+=twist*.17*sin(p.y*3.0-flow)*max(0.0,1.0-p.y*p.y);
    p.y+=twist*.08*sin(p.x*3.5+flow);
    p.x*=1.0+(u.motion.z-1.0)*(.7+.3*p.y);
    p.y*=1.0+(u.motion.w-1.0)*(.7+.3*p.x);
    return p;
}
vertex VertexOut orbVertex(uint id [[vertex_id]], const device float4* vertices [[buffer(0)]], constant Uniforms& u [[buffer(1)]]) {
    VertexOut out;
    float3 original=vertices[id].xyz, n=normalize(original);
    float3 tangent=normalize(cross(abs(n.y)>.9?float3(1,0,0):float3(0,1,0),n)), bitangent=normalize(cross(n,tangent));
    float3 p=deform(original,u);
    out.normal=normalize(cross(deform(original+tangent*.004,u)-p,deform(original+bitangent*.004,u)-p));
    out.surface=p;
    float size=u.layout.y;
    out.position=float4(p.x*size/u.layout.x,(p.y*size)+u.layout.z,.5-p.z*.2,1);
    out.uv=float2(0);
    return out;
}
fragment float4 orbFragment(VertexOut in [[stage_in]], constant Uniforms& u [[buffer(1)]]) {
    float3 n=normalize(in.normal), view=float3(0,0,1), light=normalize(float3(-.7,.85,1.4));
    float facing=max(dot(n,view),0.0), fresnel=pow(1.0-facing,2.5);
    float diffuse=max(dot(n,light),0.0), reflection=pow(max(dot(n,normalize(light+view)),0.0),56.0);
    float broad=pow(max(dot(n,normalize(float3(.8,-.5,1.1))),0.0),12.0);
    float current=.5+.5*sin(in.surface.y*4.0+in.surface.x*2.5+sin(in.surface.z*4.0+u.clock.x*.35));
    float3 tint=mix(u.color.rgb,u.accent.rgb,smoothstep(-.8,.8,in.surface.x-in.surface.y*.55));
    float3 color=tint*(.2+diffuse*.43+current*.12);
    color+=mix(u.accent.rgb,u.color.rgb,facing)*fresnel*(.82+u.clock.y*.34);
    color+=mix(u.color.rgb,float3(1),.3)*reflection*.7+u.accent.rgb*broad*.23;
    float band=.5+.5*sin(in.surface.y*6.0-u.clock.x*2.2+in.surface.x*2.0);
    float3 iridescence=.5+.5*cos(float3(0,2.094,4.188)+in.surface.y*5.0+u.clock.x*1.4);
    color+=mix(u.color.rgb,iridescence,.3)*band*u.color.a*.3;
    color+=u.color.rgb*pow(facing,9.0)*(.08+u.clock.z*.17);
    float rim=1.0-smoothstep(.025,.19,facing), glow=1.0-smoothstep(.04,.36,facing);
    color=mix(color,float3(1,.025,.055),rim*u.clock.w*.96)+float3(1,.025,.055)*glow*u.clock.w*.16;
    return float4(color,.88+fresnel*.12);
}
vertex VertexOut quadVertex(uint id [[vertex_id]]) {
    const float2 points[]={float2(-1,-1),float2(1,-1),float2(-1,1),float2(1,-1),float2(1,1),float2(-1,1)};
    VertexOut out; out.position=float4(points[id],.99,1); out.uv=points[id]; out.normal=0; out.surface=0; return out;
}
fragment float4 haloFragment(VertexOut in [[stage_in]], constant Uniforms& u [[buffer(1)]]) {
    float2 p=float2(in.uv.x*u.layout.x,in.uv.y-u.layout.z)/(u.layout.y*1.6);
    float distance=length(p), band=exp(-pow((distance-.5)*3.3,2.0)), fade=1.0-smoothstep(.7,1.0,distance);
    return float4(mix(u.color.rgb,u.accent.rgb,smoothstep(-.8,.8,p.x+p.y*.5)),band*fade*(.22+u.clock.y*.16));
}
fragment float4 cardFragment(VertexOut in [[stage_in]], constant Uniforms& u [[buffer(1)]]) {
    float2 size=u.layout.xy, p=in.uv*size*.5;
    float radius=min(24.0,min(size.x,size.y)*.14);
    float2 q=abs(p)-size*.5+radius+1;
    float edge=length(max(q,0.0))+min(max(q.x,q.y),0.0)-radius;
    float surface=1.0-smoothstep(-1.0,1.0,edge);
    float border=(1.0-smoothstep(0.0,1.5,abs(edge+1.0)))*.28;
    float highlight=pow(max(0.0,1.0-length(in.uv-float2(-.65,.75))*.55),3.0);
    float flow=.5+.5*sin(in.uv.x*2.5+in.uv.y*3.0+u.clock.x*.22);
    float3 glass=u.color.rgb*(.09+flow*.025)+float3(.045)+u.accent.rgb*highlight*.11;
    glass+=mix(float3(.42),u.color.rgb,.35)*border;
    return float4(glass,surface*(.91+highlight*.05));
}
