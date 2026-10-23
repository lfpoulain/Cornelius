import SwiftUI
import MetalKit

struct OrbAppearance {
    var hue: Float = 218; var accent: Float = 245; var energy: Float = 0.17; var vivid: Float = 0.2
    var awake = false; var offline = true; var speech: Float = 0; var shimmer: Float = 0; var search: Float = 0
    var recognized: String?; var scale: Float = 1
    static func from(_ state: MirrorState?, now: Double, input: Float, output: Float) -> Self {
        guard let state else { return Self() }
        var value = Self()
        let phase = state.session.satellite == nil ? state.session.phase : "idle"
        value.awake = (state.presence.health == "ok" && state.presence.state != "absent") || (state.session.mode == 4 && phase == "ready")
        value.recognized = state.recognized(now: now) ? state.activeProfile?.id : nil
        value.offline = phase == "idle"; value.scale = Float(state.orbScale ?? 100) / 100
        let activity = output > 0.035 ? "speaking" : input > 0.05 ? "listening" : (state.voice.endsAt == nil || state.voice.endsAt! > now) ? state.voice.phase : "idle"
        switch phase {
        case "connecting": value.hue=45; value.accent=18; value.energy=0.72; value.vivid=0.9; value.shimmer=0.16
        case "closing": value.hue=12; value.accent=342; value.energy=0.3; value.vivid=0.4
        case "blocked": value.hue=350; value.accent=20; value.energy=0.22; value.vivid=0.3
        case "ready":
            switch activity {
            case "listening": value.hue=174; value.accent=188; value.energy=0.96; value.vivid=1
            case "thinking": value.hue=285; value.accent=318; value.energy=0.82; value.vivid=0.85
            case "speaking": value.hue=28; value.accent=8; value.energy=1; value.vivid=1; value.shimmer=0.6
            default: value.hue=218; value.accent=245; value.energy=0.38; value.vivid=0.36
            }
        default: break
        }
        value.speech = min(1, max(input, output) * 3); value.search = state.webSearchActive == true ? 1 : 0
        return value
    }
}
struct MetalMirror: UIViewRepresentable {
    var appearance: OrbAppearance
    var card = false
    var reduceMotion = false
    func makeCoordinator() -> Renderer { Renderer(card: card) }
    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        view.isOpaque=false; view.backgroundColor = .clear; view.clearColor=MTLClearColorMake(0,0,0,0)
        view.colorPixelFormat = .bgra8Unorm_srgb; view.depthStencilPixelFormat = .depth32Float
        view.framebufferOnly = true; view.delegate = context.coordinator
        view.isAccessibilityElement = false
        context.coordinator.configure(view)
        return view
    }
    func updateUIView(_ view: MTKView, context: Context) {
        context.coordinator.appearance=appearance; context.coordinator.reduceMotion=reduceMotion
        view.preferredFramesPerSecond = reduceMotion ? 1 : ProcessInfo.processInfo.isLowPowerModeEnabled ? 20 : card ? 30 : 60
        view.isPaused = UIApplication.shared.applicationState == .background
    }
    final class Renderer: NSObject, MTKViewDelegate {
        struct Uniforms { var clock: SIMD4<Float>; var color: SIMD4<Float>; var accent: SIMD4<Float>; var layout: SIMD4<Float>; var motion: SIMD4<Float> }
        var appearance = OrbAppearance(); var reduceMotion = false
        let card: Bool
        private var queue: MTLCommandQueue?
        private var orb: MTLRenderPipelineState?, halo: MTLRenderPipelineState?, glass: MTLRenderPipelineState?
        private var vertices: MTLBuffer?, indices: MTLBuffer?, indexCount = 0
        private var depth: MTLDepthStencilState?
        private let start = CACurrentMediaTime()
        private var previousKey: String?, greetingAt: Double?
        private var awake: Float = 0.05
        init(card: Bool) { self.card=card }
        func configure(_ view: MTKView) {
            guard let device=view.device, let library=device.makeDefaultLibrary() else { return }
            queue=device.makeCommandQueue()
            func pipeline(_ vertex: String, _ fragment: String) -> MTLRenderPipelineState? {
                let descriptor=MTLRenderPipelineDescriptor()
                descriptor.vertexFunction=library.makeFunction(name: vertex); descriptor.fragmentFunction=library.makeFunction(name: fragment)
                descriptor.colorAttachments[0].pixelFormat=view.colorPixelFormat; descriptor.depthAttachmentPixelFormat=view.depthStencilPixelFormat
                descriptor.colorAttachments[0].isBlendingEnabled=true
                descriptor.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha; descriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
                descriptor.colorAttachments[0].sourceAlphaBlendFactor = .one; descriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
                return try? device.makeRenderPipelineState(descriptor: descriptor)
            }
            orb=pipeline("orbVertex","orbFragment"); halo=pipeline("quadVertex","haloFragment"); glass=pipeline("quadVertex","cardFragment")
            let desc=MTLDepthStencilDescriptor(); desc.depthCompareFunction = .less; desc.isDepthWriteEnabled=true; depth=device.makeDepthStencilState(descriptor: desc)
            var points=[SIMD4<Float>](), triangles=[UInt16]()
            for y in 0...56 { for x in 0...80 {
                let theta=Float(y)/56 * .pi, phi=Float(x)/80 * 2 * .pi
                points.append(SIMD4(sin(theta)*cos(phi),cos(theta),sin(theta)*sin(phi),1))
            } }
            for y in 0..<56 { for x in 0..<80 { let a=UInt16(y*81+x), b=a+81; triangles += [a,b,a+1,b,b+1,a+1] } }
            vertices=device.makeBuffer(bytes: points,length: points.count*MemoryLayout<SIMD4<Float>>.stride); indices=device.makeBuffer(bytes: triangles,length: triangles.count*2); indexCount=triangles.count
        }
        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}
        func draw(in view: MTKView) {
            guard UIApplication.shared.applicationState != .background, let drawable=view.currentDrawable, let pass=view.currentRenderPassDescriptor, let command=queue?.makeCommandBuffer(), let encoder=command.makeRenderCommandEncoder(descriptor: pass) else { return }
            let fixed=ProcessInfo.processInfo.arguments.contains("-snapshot")
            let elapsed=fixed ? 1.2 : CACurrentMediaTime()-start
            let time=reduceMotion ? Float(0) : Float(elapsed)
            let a=appearance
            let target: Float=a.awake ? 0.66 : 0.045
            awake = fixed || reduceMotion ? target : awake+(target-awake)*0.08
            if previousKey != a.recognized { greetingAt=a.recognized == nil ? nil : elapsed; previousKey=a.recognized }
            var lift: Float=0, twist: Float=0, flow: Float=0, sx: Float=1, sy: Float=1
            if !reduceMotion, !fixed, let at=greetingAt {
                let t=Float((elapsed-at)/1.1)
                if t>=0 && t<1 {
                    if t<0.14 { let q=sin(t/0.14 * .pi); sx+=q*0.18; sy-=q*0.15; lift = -q*0.025 }
                    else if t<0.68 { let f=(t-0.14)/0.54; lift=sin(f * .pi)*0.16; twist=pow(sin(.pi*f),2); flow=2 * .pi*f; sx-=sin(f * .pi*2)*0.1; sy+=sin(f * .pi*2)*0.12 }
                    else { let l=(t-0.68)/0.32, q=sin(l * .pi*3)*(1-l); sx+=q*0.19; sy-=q*0.16; lift = -q*0.025; twist=sin(l * .pi*2)*(1-l)*0.2 }
                }
            }
            let saturation=(0.36+a.vivid*0.59)*(a.offline ? 0.08 : 1), lightness=0.36+a.vivid*0.18-(a.offline ? 0.04 : 0)
            let color=rgb(a.hue,saturation,lightness), accent=rgb(a.accent,saturation,lightness)
            var uniforms=Uniforms(clock: SIMD4(time,a.energy,a.speech,a.search),color: SIMD4(color.x,color.y,color.z,reduceMotion ? 0 : a.shimmer),accent: SIMD4(accent.x,accent.y,accent.z,1),layout: SIMD4(Float(view.drawableSize.width/max(1,view.drawableSize.height)),awake*min(1.3,a.scale),lift,0),motion: SIMD4(twist,flow,sx,sy))
            encoder.setDepthStencilState(depth)
            if card, let glass {
                uniforms.layout=SIMD4(Float(view.bounds.width),Float(view.bounds.height),0,0)
                encoder.setRenderPipelineState(glass); encoder.setFragmentBytes(&uniforms,length: MemoryLayout<Uniforms>.stride,index: 1); encoder.drawPrimitives(type: .triangle,vertexStart: 0,vertexCount: 6)
            } else if let halo, let orb, let vertices, let indices {
                encoder.setRenderPipelineState(halo); encoder.setFragmentBytes(&uniforms,length: MemoryLayout<Uniforms>.stride,index: 1); encoder.drawPrimitives(type: .triangle,vertexStart: 0,vertexCount: 6)
                encoder.setRenderPipelineState(orb); encoder.setVertexBuffer(vertices,offset: 0,index: 0); encoder.setVertexBytes(&uniforms,length: MemoryLayout<Uniforms>.stride,index: 1); encoder.setFragmentBytes(&uniforms,length: MemoryLayout<Uniforms>.stride,index: 1)
                encoder.drawIndexedPrimitives(type: .triangle,indexCount: indexCount,indexType: .uint16,indexBuffer: indices,indexBufferOffset: 0)
            }
            encoder.endEncoding(); command.present(drawable); command.commit()
        }
        private func rgb(_ hue: Float,_ s: Float,_ l: Float) -> SIMD3<Float> {
            let h=hue/60, c=(1-abs(2*l-1))*s, x=c*(1-abs(h.truncatingRemainder(dividingBy: 2)-1)), m=l-c/2
            let color: SIMD3<Float>
            switch h { case ..<1: color=SIMD3(c,x,0); case ..<2: color=SIMD3(x,c,0); case ..<3: color=SIMD3(0,c,x); case ..<4: color=SIMD3(0,x,c); case ..<5: color=SIMD3(x,0,c); default: color=SIMD3(c,0,x) }
            return color+SIMD3(repeating: m)
        }
    }
}
