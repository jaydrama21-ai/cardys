// GemReady — native SwiftUI starter. Core flow: onboarding (age + privacy),
// scan front/back, condition estimate (beta: centering + photo checks),
// outcomes, collection, settings with Delete My Data.
//
// Not compiled in the session that wrote it (no Xcode there). Expect small
// fixes on first build. See ios/README.md.

import SwiftUI
import PhotosUI

extension Color {
    static let bg = Color(red: 13 / 255, green: 15 / 255, blue: 20 / 255)
    static let raised = Color(red: 20 / 255, green: 23 / 255, blue: 32 / 255)
    static let gold = Color(red: 240 / 255, green: 186 / 255, blue: 74 / 255)
    static let good = Color(red: 54 / 255, green: 199 / 255, blue: 122 / 255)
    static let muted = Color(red: 136 / 255, green: 145 / 255, blue: 168 / 255)
}
let DISCLAIMER = "A condition estimate from photos, not a grade. Graders can and do differ. Not affiliated with PSA, BGS, CGC or TAG."

@main
struct GemReadyApp: App {
    @StateObject private var settings = Settings.shared
    @StateObject private var store = ScanStore.shared
    var body: some Scene {
        WindowGroup {
            Group {
                if !settings.ageChecked { AgeCheckView() }
                else if settings.privacySeen < 1 { PrivacyNoticeView() }
                else { RootTabs() }
            }
            .environmentObject(settings)
            .environmentObject(store)
            .tint(.gold)
        }
    }
}

struct RootTabs: View {
    var body: some View {
        TabView {
            ScanView().tabItem { Label("Scan", systemImage: "viewfinder") }
            CollectionView().tabItem { Label("Collection", systemImage: "square.stack") }
            SettingsView().tabItem { Label("Settings", systemImage: "slider.horizontal.3") }
        }
    }
}

// MARK: - Onboarding

struct AgeCheckView: View {
    @EnvironmentObject var settings: Settings
    @State private var year: Int?
    private let thisYear = Calendar.current.component(.year, from: Date())
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("What year were you born?").font(.custom("DMSerifDisplay-Regular", size: 34, relativeTo: .largeTitle))
            Text("We ask everyone. It sets which features are on; we don't send your age anywhere.").foregroundStyle(Color.muted)
            Picker("Birth year", selection: $year) {
                Text("Select year").tag(Int?.none)
                ForEach((thisYear - 100...thisYear).reversed(), id: \.self) { Text(String($0)).tag(Int?.some($0)) }
            }
            .pickerStyle(.wheel)
            Spacer()
            Button("Continue") {
                guard let y = year else { return }
                let under13 = thisYear - y < 13
                settings.under13 = under13
                if under13 { settings.improve = false }
                settings.ageChecked = true
            }
            .buttonStyle(.borderedProminent).disabled(year == nil).frame(maxWidth: .infinity)
        }
        .padding(20)
    }
}

struct PrivacyNoticeView: View {
    @EnvironmentObject var settings: Settings
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Your slabs help grading get better").font(.largeTitle.weight(.regular))
                Text("When you add a slab result, we learn from the real grade. It's anonymous by design: nothing we keep can be traced back to you. You choose.").foregroundStyle(Color.muted)
                Text("WHAT WE KEEP").font(.caption.monospaced()).foregroundStyle(Color.muted)
                Label("Cropped photos of the card itself", systemImage: "checkmark")
                Label("The grade it got, and which grader", systemImage: "checkmark")
                Text("NEVER KEPT").font(.caption.monospaced()).foregroundStyle(Color.muted)
                ForEach(["Your name, email or account", "Location, phone model or when the photo was taken", "Anything around the card, like your hands or room", "Cards with a signature or writing on them"], id: \.self) {
                    Label($0, systemImage: "xmark").foregroundStyle(Color.muted)
                }
                Text("Change this anytime in Settings → Privacy. The app works the same either way.").font(.footnote).foregroundStyle(Color.muted)
                if settings.under13 {
                    Button("Continue") { settings.improve = false; settings.privacySeen = 1 }.buttonStyle(.borderedProminent)
                } else {
                    HStack {
                        Button("Keep It On") { settings.improve = true; settings.privacySeen = 1 }.buttonStyle(.borderedProminent)
                        Button("Turn It Off") { settings.improve = false; settings.privacySeen = 1 }.buttonStyle(.bordered)
                    }
                }
            }
            .padding(20)
        }
    }
}

// MARK: - Scan

struct ScanView: View {
    @EnvironmentObject var store: ScanStore
    @State private var scan = Scan()
    @State private var picking: PhotosPickerItem?
    @State private var showCamera = false
    @State private var side = "front"
    @State private var problem: PhotoCheck?
    @State private var pending: UIImage?
    @State private var goEstimate = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                HStack { Text("Gem").font(.title) + Text("Ready").font(.title.italic()).foregroundColor(.gold); Spacer(); Text("Is it gem ready?").font(.caption.monospaced()).foregroundStyle(Color.muted) }
                HStack(spacing: 12) {
                    slotTile("Front", file: scan.frontFile)
                    slotTile("Back", file: scan.backFile)
                }
                Text("Now: \(side == "front" ? "Front" : "Back"), full card. Fill the frame, no glare.").font(.footnote)
                HStack {
                    PhotosPicker(selection: $picking, matching: .images) { Label("Upload", systemImage: "photo") }
                    Spacer()
                    Button { showCamera = true } label: { Circle().stroke(Color.gold, lineWidth: 3).frame(width: 72, height: 72).overlay(Circle().fill(.white).padding(8)) }
                        .accessibilityLabel("Take photo")
                    Spacer()
                    Button("Grade now") { Task { await analyze() } }.disabled(scan.frontFile == nil)
                }
            }
            .padding(20)
            .navigationDestination(isPresented: $goEstimate) { EstimateView(scanID: scan.id) }
            .sheet(isPresented: $showCamera) { CameraPicker { img in accept(img) } }
            .onChange(of: picking) { _, item in
                Task { if let data = try? await item?.loadTransferable(type: Data.self), let img = UIImage(data: data) { accept(img) } }
            }
            .alert(problemTitle, isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
                Button("Retake", role: .cancel) { pending = nil }
                Button("Use Anyway") { if let p = pending { save(p) } }
            } message: { Text("Glare and blur hide wear, so the checks would miss it.") }
        }
    }

    private var problemTitle: String {
        guard let p = problem, let first = p.issues.first else { return "" }
        switch first {
        case .glare: return "Glare on the \(p.glareWhere ?? "card")"
        case .blur: return "Too blurry"
        case .dark: return "Too dark"
        case .washed: return "Washed out"
        case .noCard: return "Can't find the card edges"
        }
    }

    private func slotTile(_ label: String, file: String?) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color.raised).aspectRatio(63 / 88, contentMode: .fit)
            if let img = store.image(file) { Image(uiImage: img).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 12)) }
            else { Text(label).foregroundStyle(Color.muted) }
        }
    }

    private func accept(_ img: UIImage) {
        let check = Analysis.checks(img)
        if !check.ok { pending = img; problem = check; return }
        save(img)
    }
    private func save(_ img: UIImage) {
        let file = store.storePhoto(img)
        let check = Analysis.checks(img)
        let flat = Analysis.flattenedCard(img)
        let c = flat.flatMap { Analysis.centering($0) }
        if side == "front" { scan.frontFile = file; scan.frontCheck = check; scan.front = c; side = "back" }
        else { scan.backFile = file; scan.backCheck = check; scan.back = c }
        pending = nil; problem = nil
        store.save(scan)
    }
    private func analyze() async {
        if scan.card == nil, let img = store.image(scan.frontFile) {
            let text = await TextReader.read(img)
            if let m = try? await API.shared.match(text: text), m.id != nil, let c = m.candidates.first { scan.card = c }
        }
        store.save(scan)
        goEstimate = true
    }
}

// MARK: - Estimate

struct EstimateView: View {
    @EnvironmentObject var store: ScanStore
    @EnvironmentObject var settings: Settings
    let scanID: UUID
    @State private var query = ""
    @State private var results: [Card] = []
    var scan: Scan? { store.scans.first { $0.id == scanID } }

    var body: some View {
        ScrollView {
            if let scan {
                VStack(alignment: .leading, spacing: 14) {
                    if let card = scan.card {
                        Text(card.name).font(.title)
                        Text("\(card.set) · #\(card.num)").font(.footnote).foregroundStyle(Color.muted)
                    } else {
                        Text("Which card is this?").font(.title2)
                        TextField("Card name or number", text: $query).textFieldStyle(.roundedBorder)
                            .onSubmit { Task { results = (try? await API.shared.search(query)) ?? [] } }
                        ForEach(results) { c in
                            Button("\(c.name) · \(c.set) · \(c.num)") { var s = scan; s.card = c; store.save(s) }
                        }
                    }
                    GroupBox {
                        Text("Grade odds are still being trained").font(.headline)
                        Text("They switch on once the model beats a simple guess on real slabs. Centering, photo checks, prices and outcomes all work now.").font(.footnote).foregroundStyle(Color.muted)
                    }
                    Picker("Scale", selection: $settings.grader) { ForEach(Grader.allCases) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented)
                    GroupBox("Centering · \(settings.grader.rawValue) limits\(settings.grader.centeringApproximate ? " (approximate)" : "")") {
                        LabeledContent("Front", value: scan.front?.label ?? "Couldn't measure")
                        LabeledContent("Back", value: scan.back?.label ?? "No back photo")
                        LabeledContent("Best centering grade", value: centeringGrade(settings.grader, front: scan.front, back: scan.back) ?? "—")
                    }
                    GroupBox("Photo checks") {
                        LabeledContent("Front", value: scan.frontCheck?.ok == true ? "Passed" : "Issues")
                        LabeledContent("Back", value: scan.backFile == nil ? "—" : scan.backCheck?.ok == true ? "Passed" : "Issues")
                    }
                    Text(DISCLAIMER).font(.caption2).foregroundStyle(Color.muted)
                    if let card = scan.card {
                        NavigationLink("See Outcomes If You Grade") { OutcomesView(card: card) }.buttonStyle(.borderedProminent)
                    }
                }
                .padding(20)
            }
        }
        .navigationTitle("Condition Estimate")
    }
}

// MARK: - Outcomes

struct OutcomesView: View {
    @EnvironmentObject var settings: Settings
    let card: Card
    @State private var o: Outcomes?
    @State private var error: String?
    var body: some View {
        List {
            if let o {
                Section { LabeledContent("Sell raw today", value: o.raw.formatted(.currency(code: "USD"))) }
                Section(o.tier.map { "\(o.grader) \($0.name) · ~\($0.days ?? 0) days" } ?? "\(o.grader) · no open tier") {
                    ForEach(o.rows) { r in
                        HStack {
                            Text(r.grade).font(.body.monospaced())
                            Text(r.sale.map { "~" + $0.formatted(.currency(code: "USD").precision(.fractionLength(0))) } ?? "").foregroundStyle(Color.muted)
                            Spacer()
                            if let n = r.net { Text((n >= 0 ? "+" : "") + n.formatted(.currency(code: "USD").precision(.fractionLength(0)))).foregroundStyle(n >= 0 ? Color.good : .red) }
                            else { Text(r.reason == "TOO_FEW_SALES" ? "TOO FEW SALES" : "NO RECENT SALES").font(.caption.monospaced()).foregroundStyle(Color.muted) }
                        }
                    }
                }
                Section {
                    if o.verdict.kind == "worth", let at = o.verdict.worthAt { Text("Worth sending if it gets a \(at) or better.").font(.headline) }
                    else if o.verdict.kind == "not-worth" { Text("Not worth sending at today's prices.").font(.headline) }
                    Text("Each amount is what you'd keep after grading and selling, compared with selling raw today. eBay's fee is taken out of both. Fees as of \(o.feesAsOf). These are estimates, not financial advice.").font(.caption).foregroundStyle(Color.muted)
                }
            } else if let error { Text(error) } else { ProgressView() }
        }
        .navigationTitle("Outcomes If You Grade")
        .task(id: settings.grader) {
            do { o = try await API.shared.outcomes(cardId: card.id, grader: settings.grader, shippingIn: 0, minNet: settings.minNet) }
            catch APIError.offline { error = "You're offline. Prices fill in when you're back online." }
            catch { self.error = "Couldn't load prices." }
        }
    }
}

// MARK: - Collection & Settings

struct CollectionView: View {
    @EnvironmentObject var store: ScanStore
    var body: some View {
        NavigationStack {
            List {
                if store.scans.isEmpty { Text("No cards yet. Scan your first.").foregroundStyle(Color.muted) }
                ForEach(store.scans.filter { $0.card != nil }) { s in
                    NavigationLink(value: s) {
                        VStack(alignment: .leading) {
                            Text(s.card!.name).font(.headline)
                            Text("Centering \(s.front.map { "\(Centering.worst($0.lr))/\(100 - Centering.worst($0.lr))" } ?? "—") · \(s.createdAt.formatted(date: .abbreviated, time: .omitted))").font(.caption.monospaced()).foregroundStyle(Color.muted)
                        }
                    }
                }
                .onDelete { idx in idx.map { store.scans.filter { $0.card != nil }[$0] }.forEach(store.remove) }
            }
            .navigationTitle("Collection")
            .navigationDestination(for: Scan.self) { EstimateView(scanID: $0.id) }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var store: ScanStore
    @State private var confirmDelete = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Preferred grader") { Picker("Grader", selection: $settings.grader) { ForEach(Grader.allCases) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented) }
                Section("When to suggest grading") {
                    LabeledContent("Minimum net vs raw") { TextField("100", value: $settings.minNet, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
                }
                Section("Privacy") {
                    Toggle("Improve grading with my card photos", isOn: $settings.improve).disabled(settings.under13)
                    Button("Delete My Data", role: .destructive) { confirmDelete = true }
                }
                Section("About") {
                    Link("Privacy Policy", destination: URL(string: "https://gemready.app/legal/privacy.html")!)
                    Link("Terms of Use", destination: URL(string: "https://gemready.app/legal/terms.html")!)
                    Text("Estimates, not grades. Not affiliated with PSA, Beckett, CGC, TAG, The Pokémon Company or Nintendo.").font(.caption).foregroundStyle(Color.muted)
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Delete everything?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete My Data", role: .destructive) {
                    Task { try? await API.shared.deleteMe(); store.wipe(); settings.wipe() }
                }
            } message: { Text("Your anonymous sign-in and alerts on our servers, and your collection and photos on this phone. This can't be undone.") }
        }
    }
}
