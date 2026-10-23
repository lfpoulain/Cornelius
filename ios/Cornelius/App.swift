import SwiftUI
import AVFoundation

@main struct CorneliusApp: App {
    @StateObject private var client=MirrorClient()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            Group { if client.credential != nil || ProcessInfo.processInfo.arguments.contains("-demo") { MirrorView(client: client) } else { PairingView(client: client) } }
                .preferredColorScheme(.dark)
                .onOpenURL { url in Task { await client.pair(url.absoluteString) } }
                .task {
                    if ProcessInfo.processInfo.arguments.contains("-demo") { client.loadDemo() }
                    else if client.credential != nil { client.activate() }
                }
                .onChange(of: phase) { _, value in
                    guard !ProcessInfo.processInfo.arguments.contains("-demo") else { return }
                    if value == .background { client.setBackground(true) }
                    else if value == .active { client.setBackground(false) }
                }
        }
    }
}
struct PairingView: View {
    @ObservedObject var client: MirrorClient
    @StateObject private var discovery=Discovery()
    @State private var link=""
    @State private var scanner=false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 25) {
                    (Text("cornelius").foregroundStyle(.white.opacity(0.9))+Text(" /").foregroundStyle(.white.opacity(0.35))).font(.custom("DMSans-Medium", size: 36, relativeTo: .largeTitle))
                    Text("Votre miroir, avec vous.").font(.title2)
                    Text("Sur l’administration de votre Cornelius, ouvrez Mise en route → App iPhone → Associer un iPhone. Scannez le code pour établir une connexion chiffrée.").foregroundStyle(.secondary)
                    Button { scanner=true } label: { Label("Scanner le QR code", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(.borderedProminent).disabled(client.busy)
                    Text("Ou collez le lien d’association").font(.headline)
                    TextField("cornelius://pair?data=…", text: $link, axis: .vertical).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder).privacySensitive()
                    Button("Associer") { Task { await client.pair(link); link="" } }.disabled(link.isEmpty || client.busy).frame(minHeight: 44)
                    if client.busy { ProgressView("Association…") }
                    if let message=client.message { Text(message).foregroundStyle(.orange).accessibilityAddTraits(.updatesFrequently) }
                    if !discovery.servers.isEmpty {
                        Text("Cornelius sur le réseau local").font(.headline)
                        ForEach(discovery.servers.keys.sorted(), id: \.self) { name in
                            VStack(alignment: .leading) { Text(name); if let url=discovery.servers[name] { Text(url.absoluteString).font(.caption).foregroundStyle(.secondary) } }
                        }
                        Text("Confirmez l’identité du serveur avec son QR code. La découverte seule ne l’autorise pas.").font(.footnote).foregroundStyle(.secondary)
                    }
                    if let error=discovery.error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                    Text("À la maison : même réseau Wi-Fi. À l’extérieur : Tailscale connecté sur l’iPhone et le serveur. Aucun compte Cornelius n’est nécessaire.").font(.footnote).foregroundStyle(.secondary)
                }.padding(28).frame(maxWidth: 650)
            }.frame(maxWidth: .infinity).background(.black)
            .sheet(isPresented: $scanner) { QRScanner { value in scanner=false; Task { await client.pair(value) } }.ignoresSafeArea() }
            .onAppear { discovery.start() }.onDisappear { discovery.stop() }
        }
    }
}
struct AppSettings: View {
    @ObservedObject var client: MirrorClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var discovery=Discovery()
    @State private var address=""
    @State private var confirmForget=false
    var body: some View {
        NavigationStack {
            Form {
                Section("Connexion") {
                    LabeledContent("État", value: client.connected ? client.transport : "Déconnecté")
                    if let endpoint=client.endpoint { Text(endpoint.url.absoluteString).font(.footnote) }
                    TextField("https://cornelius.local:3443", text: $address).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Button("Mémoriser cette adresse locale") { client.addLocalAddress(address); address="" }
                    ForEach(discovery.servers.keys.sorted(), id: \.self) { name in Button(name) { if let url=discovery.servers[name] { client.addLocalAddress(url.absoluteString) } } }
                    Text("Une nouvelle adresse n’est acceptée que si elle présente la clé du serveur associé.").font(.footnote)
                    Button("Ouvrir Tailscale") { if let url=URL(string: "tailscale://") { UIApplication.shared.open(url) } }
                    Text("L’accès extérieur utilise Tailscale installé séparément. Le serveur doit rester allumé.").font(.footnote)
                }
                Section("Micro et caméra") {
                    Toggle("Microphone coupé", isOn: $client.muted)
                    Button("Autorisations iOS") { if let url=URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                    Text("La reconnaissance est effectuée sur votre serveur. Les images ne sont pas enregistrées par l’app. Quand vous quittez l’app, seule la conversation déjà ouverte continue ; la caméra s’arrête.").font(.footnote)
                }
                Section {
                    Button("Oublier ce serveur", role: .destructive) { confirmForget=true }
                    Text("Pour retirer aussi l’autorisation côté serveur, révoquez cet iPhone dans l’administration web.").font(.footnote)
                }
            }.navigationTitle("Réglages").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fermer") { dismiss() } } }
            .confirmationDialog("Oublier l’association avec ce serveur ?", isPresented: $confirmForget, titleVisibility: .visible) { Button("Oublier", role: .destructive) { client.forget(); dismiss() } }
            .onAppear { discovery.start() }.onDisappear { discovery.stop() }
        }.preferredColorScheme(.dark)
    }
}
struct QRScanner: UIViewControllerRepresentable {
    var result: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerController { let value=ScannerController(); value.result=result; return value }
    func updateUIViewController(_ controller: ScannerController, context: Context) {}
    final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        let session=AVCaptureSession()
        let queue=DispatchQueue(label: "cornelius.qr")
        var result: ((String) -> Void)?
        var layer: AVCaptureVideoPreviewLayer?
        var delivered=false
        override func viewDidLoad() {
            super.viewDidLoad(); view.backgroundColor = .black
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                guard let self else { return }
                if granted { self.queue.async { self.configure() } }
                else { DispatchQueue.main.async { let label=UILabel(); label.text="Autorisez la caméra dans Réglages, ou collez le lien d’association."; label.textColor = .white; label.numberOfLines=0; label.frame=self.view.bounds.insetBy(dx: 30, dy: 60); self.view.addSubview(label) } }
            }
        }
        func configure() {
            guard let camera=AVCaptureDevice.default(for: .video), let input=try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else { return }
            session.addInput(input)
            let output=AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }; session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main); output.metadataObjectTypes=[.qr]
            DispatchQueue.main.async { let layer=AVCaptureVideoPreviewLayer(session: self.session); layer.videoGravity = .resizeAspectFill; layer.frame=self.view.bounds; self.view.layer.addSublayer(layer); self.layer=layer }
            session.startRunning()
        }
        override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); layer?.frame=view.bounds }
        override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); queue.async { self.session.stopRunning() } }
        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard !delivered, let value=(objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue, value.hasPrefix("cornelius://pair?") else { return }
            delivered=true; queue.async { self.session.stopRunning() }; result?(value)
        }
    }
}
