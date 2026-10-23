import SwiftUI

struct MirrorView: View {
    @ObservedObject var client: MirrorClient
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var settings = false
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { timeline in
            let now = ProcessInfo.processInfo.arguments.contains("-demo") ? client.snapshot?.sentAt ?? 0 : client.freshness.serverNow(timeline.date)
            let fresh = client.freshness.fresh(at: timeline.date) || ProcessInfo.processInfo.arguments.contains("-demo")
            GeometryReader { geometry in
                let state = fresh && !client.interrupted ? client.snapshot?.state : nil
                let divisions = regions(geometry, division: true)
                let occlusions = regions(geometry, division: false)
                let cut = divisions.first(where: { $0.intersects(CGRect(origin: .zero, size: geometry.size)) })
                let full = CGRect(origin: .zero, size: geometry.size)
                if let cut {
                    let first = cut.width > cut.height ? CGRect(x: 0, y: 0, width: full.width, height: max(0, cut.minY - 10)) : CGRect(x: 0, y: 0, width: max(0, cut.minX - 10), height: full.height)
                    let second = cut.width > cut.height ? CGRect(x: 0, y: min(full.height, cut.maxY + 10), width: full.width, height: max(0, full.height - cut.maxY - 10)) : CGRect(x: min(full.width, cut.maxX + 10), y: 0, width: max(0, full.width - cut.maxX - 10), height: full.height)
                    let primary = avoiding(occlusions, in: first)
                    let secondary = avoiding(occlusions, in: second)
                    VStack(spacing: 8) { header(state, fresh: fresh); ambient(state, now: now); orb(state, now: now).frame(maxHeight: .infinity); footer(state, now: now) }
                        .padding(16).frame(width: primary.width, height: primary.height).position(x: primary.midX, y: primary.midY)
                    cards(state, now: now).padding(16).frame(width: secondary.width, height: secondary.height).position(x: secondary.midX, y: secondary.midY)
                } else {
                    let bounds = avoiding(occlusions, in: full)
                    VStack(spacing: 12) {
                        header(state, fresh: fresh)
                        if bounds.width > 650 && bounds.width > bounds.height * 1.15 {
                            HStack(spacing: 18) {
                                cards(state, now: now, primaryOnly: true).frame(maxWidth: .infinity)
                                VStack(spacing: 0) { ambient(state, now: now); orb(state, now: now) }.frame(maxWidth: .infinity)
                                cards(state, now: now, secondaryOnly: true).frame(maxWidth: .infinity)
                            }
                        } else {
                            ambient(state, now: now)
                            orb(state, now: now).frame(minHeight: min(150, bounds.height * 0.35), maxHeight: bounds.height * 0.43)
                            cards(state, now: now).frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                        footer(state, now: now)
                    }
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .frame(width: bounds.width, height: bounds.height).position(x: bounds.midX, y: bounds.midY)
                }
            }
        }
        .background(Color.black.ignoresSafeArea()).foregroundStyle(.white.opacity(0.9))
        .font(.custom("DMSans-Regular", size: 16, relativeTo: .body))
        .sheet(isPresented: $settings) { AppSettings(client: client) }
    }
    private func regions(_ geometry: GeometryProxy, division: Bool) -> [CGRect] {
        if #available(iOS 27.1, *) { return geometry.reservedRegions(kind: division ? .division : .occlusion).filter(\.isActive).map(\.frame) }
        return []
    }
    /// Reserved-region frames use this GeometryReader's coordinates, including asymmetric folds.
    private func avoiding(_ regions: [CGRect], in rect: CGRect) -> CGRect {
        regions.reduce(rect) { available, obstruction in
            let blocked = obstruction.insetBy(dx: -12, dy: -12).intersection(available)
            guard !blocked.isNull, !blocked.isEmpty else { return available }
            let candidates = [
                CGRect(x: available.minX, y: available.minY, width: available.width, height: max(0, blocked.minY - available.minY)),
                CGRect(x: available.minX, y: blocked.maxY, width: available.width, height: max(0, available.maxY - blocked.maxY)),
                CGRect(x: available.minX, y: available.minY, width: max(0, blocked.minX - available.minX), height: available.height),
                CGRect(x: blocked.maxX, y: available.minY, width: max(0, available.maxX - blocked.maxX), height: available.height)
            ]
            return candidates.max(by: { $0.width * $0.height < $1.width * $1.height }) ?? available
        }
    }
    private func header(_ state: MirrorState?, fresh: Bool) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                (Text("cornelius").foregroundStyle(.white.opacity(0.8)) + Text(" /").foregroundStyle(.white.opacity(0.35))).font(.custom("DMSans-Medium", size: 20, relativeTo: .title3)).accessibilityLabel("Cornelius")
                if let message = client.message ?? blocker(state, fresh: fresh) { Text(message).font(.footnote).foregroundStyle(Color(red: 0.88, green: 0.76, blue: 0.55)).accessibilityAddTraits(.updatesFrequently) }
            }
            Spacer()
            Button { settings = true } label: { Image(systemName: "gearshape").frame(width: 44, height: 44) }.accessibilityLabel("Réglages de l’app").tint(.white.opacity(0.5))
        }
    }
    private func blocker(_ state: MirrorState?, fresh: Bool) -> String? {
        guard fresh else { return "Connexion au serveur perdue, nouvelle tentative…" }
        if state?.openaiBlocked == true { return "Conversation désactivée dans l’administration." }
        if state?.session.manualStop == true { return "Conversation arrêtée." }
        if let satellite = state?.session.satellite { return "Conversation dans « \(satellite.name) »." }
        if state?.privacyMode == true, (state?.presence.peopleCount ?? 0) > 1 { return "Conversation en pause : plusieurs personnes devant le miroir." }
        if state?.setup?.perception == false { return "Service de reconnaissance indisponible : voir l’administration." }
        if state?.session.phase == "blocked" { return state?.session.reason ?? "Cornelius est momentanément indisponible." }
        return nil
    }
    private func orb(_ state: MirrorState?, now: Double) -> some View {
        VStack(spacing: 0) {
            MetalMirror(appearance: .from(state, now: now, input: client.inputLevel, output: client.outputLevel), reduceMotion: reduceMotion)
                .aspectRatio(1, contentMode: .fit)
                .accessibilityElement().accessibilityLabel(orbLabel(state))
            if state?.voice.phase == "listening" && state?.session.phase == "ready" {
                Capsule().fill(Color.cyan.opacity(0.7)).frame(width: CGFloat(30 + min(1, client.inputLevel * 5) * 80), height: 2).accessibilityHidden(true)
            }
            Text(state?.voice.phase == "thinking" && state?.session.phase == "ready" ? "Je réfléchis…" : " ").font(.footnote).foregroundStyle(.white.opacity(0.55))
        }
    }
    private func orbLabel(_ state: MirrorState?) -> String {
        guard let state else { return "En veille" }
        switch state.session.phase { case "connecting": return "Ouverture de la conversation"; case "ready": switch state.voice.phase { case "listening": return "Cornelius écoute"; case "thinking": return "Cornelius réfléchit"; case "speaking": return "Cornelius parle"; default: return "Conversation en cours" }; case "blocked": return "Conversation indisponible"; default: return "En veille" }
    }
    private func ambient(_ state: MirrorState?, now: Double) -> some View {
        HStack(alignment: .top, spacing: 24) {
            ForEach(Array((state?.ambient(now: now) ?? []).prefix(2))) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.label.uppercased()).font(.caption2).tracking(1.4).foregroundStyle(.white.opacity(0.4))
                    if let content = item.content {
                        if let value = content.value { Text(value).font(.custom("DMSans-Medium", size: 25, relativeTo: .title2)) }
                        if let subtitle = content.subtitle { Text(subtitle).font(.caption).foregroundStyle(.white.opacity(0.6)) }
                        ForEach(content.items.prefix(3), id: \.self) { row in Text("\(row.label)  \(row.value)").font(.caption) }
                    }
                    if item.status == "stale" { Text("Dernière donnée connue" + (item.fetchedAt.map { " · " + age($0, now: now) } ?? "")).font(.caption2).foregroundStyle(.orange.opacity(0.8)) }
                    else if item.status == "loading" { Text("Actualisation…").font(.caption2) }
                    else if item.status == "error" { Text("Source indisponible").font(.caption2) }
                    else if item.status == "empty" { Text("Aucune donnée disponible").font(.caption2) }
                    else if let date = item.fetchedAt, item.content?.showCollectedAt != false { Text("Relevé " + age(date, now: now)).font(.caption2).foregroundStyle(.white.opacity(0.4)) }
                }
            }
            Spacer(minLength: 0)
        }.accessibilityElement(children: .contain)
    }
    private func age(_ value: String, now: Double) -> String {
        guard let date = ISO8601DateFormatter().date(from: value) ?? ISO8601DateFormatter.fractional.date(from: value) else { return value }
        let formatter = RelativeDateTimeFormatter(); formatter.locale = Locale(identifier: "fr_FR"); formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date(timeIntervalSince1970: now / 1000))
    }
    private func cards(_ state: MirrorState?, now: Double, primaryOnly: Bool = false, secondaryOnly: Bool = false) -> some View {
        let all = Array((state?.cards ?? []).filter { $0.visible(in: state!, now: now) }.prefix(3))
        let visible = primaryOnly ? Array(all.prefix(1)) : secondaryOnly ? Array(all.dropFirst()) : all
        return ScrollView {
            VStack(spacing: 12) { ForEach(visible) { card in NativeCard(card: card, client: client, compact: card.id != all.first?.id, reduceMotion: reduceMotion) } }
        }.scrollIndicators(.hidden)
    }
    private func footer(_ state: MirrorState?, now: Double) -> some View {
        VStack(spacing: 8) {
            if let state, state.presence.health == "ok", now - (state.presence.observedAt ?? 0) < 2000 {
                HStack { ForEach(state.presence.people) { person in Text(state.profiles.first(where: { $0.id == person.profileId })?.name ?? "Personne inconnue").font(.caption).padding(.horizontal, 10).padding(.vertical, 6).background(Capsule().fill(person.engaged ? Color.green.opacity(0.16) : Color.white.opacity(0.06))).overlay(Capsule().strokeBorder(person.profileId == state.activeProfile?.id ? Color.white.opacity(0.3) : .clear)) } }
            }
            if state?.imageGeneration != nil { Text("Image en création").font(.caption).foregroundStyle(.purple) }
            HStack(spacing: 18) {
                if client.interrupted || !client.audioReady {
                    Button(client.interrupted ? "Afficher ici" : "Activer le miroir") { client.activate() }.buttonStyle(.borderedProminent).tint(.white.opacity(0.15))
                } else {
                    Button { client.muted.toggle() } label: { Image(systemName: client.muted ? "mic.slash.fill" : "mic.fill").frame(minWidth: 44, minHeight: 44) }.accessibilityLabel(client.muted ? "Réactiver le microphone" : "Couper le microphone")
                    if state?.session.phase == "ready" { Button("Terminer") { client.stopConversation() }.frame(minHeight: 44) }
                    else if state?.session.manualStop == true { Button("Reprendre") { client.send(["type": "start"]) }.frame(minHeight: 44) }
                }
            }.font(.callout).tint(.white.opacity(0.75))
        }
    }
}
private extension ISO8601DateFormatter { static var fractional: ISO8601DateFormatter { let value=ISO8601DateFormatter(); value.formatOptions=[.withInternetDateTime,.withFractionalSeconds]; return value } }
struct NativeCard: View {
    let card: DisplayCard
    @ObservedObject var client: MirrorClient
    let compact: Bool; let reduceMotion: Bool
    @State private var image: UIImage?
    @State private var appeared = false
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if card.content.cardType == "image" {
                if let image { Image(uiImage: image).resizable().scaledToFit().accessibilityLabel(card.content.title) }
                else { ProgressView("Image en cours de chargement").frame(maxWidth: .infinity, minHeight: 140) }
            } else {
                Text((card.content.cardType == "luna" ? "Réponse" : card.content.title) + ((card.stale == true || card.content.stale == true) ? " · hors ligne" : "")).font(.caption).tracking(0.8).foregroundStyle(.white.opacity(0.55))
                if card.content.cardType == "luna" { Text(card.content.title).font(.custom("DMSans-Medium", size: compact ? 17 : 21, relativeTo: .headline)) }
                if let value = card.content.primaryValue { Text(value).font(.custom("DMSans-Medium", size: compact ? 24 : 34, relativeTo: .title)) }
                if let subtitle = card.content.subtitle { Text(subtitle).foregroundStyle(.white.opacity(0.8)) }
                if let description = card.content.description { Text(description).font(.callout).foregroundStyle(.white.opacity(0.7)) }
                ForEach(Array(card.content.items.prefix(compact ? 3 : 12).enumerated()), id: \.offset) { _, item in HStack(alignment: .firstTextBaseline) { Text(item.label).foregroundStyle(.white.opacity(0.65)); Spacer(); Text(item.value) }.font(.callout) }
                ForEach(card.sources) { source in
                    if let url = source.url, ["https", "http"].contains(url.scheme ?? "") { Link(source.title, destination: url).font(.caption).tint(.white.opacity(0.55)) }
                    else { Text(source.title).font(.caption2).foregroundStyle(.white.opacity(0.45)) }
                }
            }
        }
        .padding(card.content.cardType == "image" ? 0 : 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { MetalMirror(appearance: cardAppearance, card: true, reduceMotion: reduceMotion) }
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .opacity(appeared ? 1 : 0).scaleEffect(appeared ? 1 : 0.88, anchor: .top)
        .onAppear { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.9)) { appeared=true } }
        .task(id: card.id) { if let path=card.content.imageUrl, let data=await client.image(path) { image=UIImage(data: data) } }
        .accessibilityElement(children: .contain)
    }
    private var cardAppearance: OrbAppearance {
        var a=OrbAppearance(); a.offline=false; a.vivid=0.5
        switch card.content.addonId { case "weather": a.hue=205; a.accent=210; case "transit": a.hue=35; a.accent=25; case "clock": a.hue=215; a.accent=220; default: a.hue=260; a.accent=285 }
        return a
    }
}
