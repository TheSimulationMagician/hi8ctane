// Hi8ctane home-screen widget (WidgetKit, iOS 17+).
// A countdown to the next good session, the week as bars, and who's going.
// A tap opens that session in the app, ready for I'M GOING.
//
// Data: one small JSON from the widget feed (supabase/functions/widget), fetched about every 30 minutes.
// Between fetches the countdown moves on its own: the timeline holds one entry per step (hourly, then
// every minute in the last hour), so the number stays right without the network.
// Settings (region, sport, weight) come from the app through the shared App Group; see Hi8Bridge.swift.
//
// NOT YET BUILT OR RUN: this file was written without Xcode. Expect small compile fixes on the first build.

import SwiftUI
import WidgetKit

// MARK: - Shared settings

enum Hi8Shared {
    static let group = "group.com.hi8ctane.app"
    static let feedBase = "https://YOUR-PROJECT.supabase.co/functions/v1/widget" // the deployed function's URL
    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }
    static var city: String { defaults.string(forKey: "city") ?? "amsterdam" }
    static var sport: String { defaults.string(forKey: "sport") ?? "kite" }
    static var kg: Int { let v = defaults.integer(forKey: "kg"); return v > 0 ? v : 75 }
}

// MARK: - Feed (widget/feed.mjs)

struct Hi8Next: Codable {
    let date: String, start: String, end: String, day: String, time: String
    let spot: String, slug: String, label: String, tone: String
    let kt: Int?, gust: Int?, dir: Int?, compass: String?
    let kite: Double?
    let going: Int, seats: Int
    let crew: String?, url: String
    let at: Int?
}

struct Hi8Day: Codable, Identifiable {
    let date: String, day: String, label: String, tone: String
    let score: Double
    let kt: Int?
    let going: Int
    var id: String { date }
}

struct Hi8Feed: Codable {
    let v: Int
    let city: String, sport: String, tz: String?
    let next: Hi8Next?
    let week: [Hi8Day]

    // "2026-11-14T08:00" in the region's time zone
    func time(_ local: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: tz ?? "Europe/Amsterdam")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return f.date(from: local)
    }
}

enum Hi8FeedLoader {
    static func load() async -> Hi8Feed? {
        var c = URLComponents(string: Hi8Shared.feedBase)
        c?.queryItems = [
            URLQueryItem(name: "city", value: Hi8Shared.city),
            URLQueryItem(name: "sport", value: Hi8Shared.sport),
            URLQueryItem(name: "kg", value: String(Hi8Shared.kg)),
        ]
        guard let url = c?.url else { return cached() }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return cached() }
            let feed = try JSONDecoder().decode(Hi8Feed.self, from: data)
            Hi8Shared.defaults.set(data, forKey: "feed") // an older forecast beats an empty widget
            return feed
        } catch {
            return cached()
        }
    }

    static func cached() -> Hi8Feed? {
        guard let d = Hi8Shared.defaults.data(forKey: "feed") else { return nil }
        return try? JSONDecoder().decode(Hi8Feed.self, from: d)
    }
}

// MARK: - The countdown

struct Hi8Count {
    let number: String, unit: String, on: Bool

    // Calendar days once it's another day; hours, then minutes, on the day; ON NOW while it runs.
    static func make(now: Date, start: Date?, end: Date?, tz: TimeZone) -> Hi8Count? {
        guard let start else { return nil }
        if let end, now >= start && now < end { return Hi8Count(number: "ON", unit: "NOW", on: true) }
        if now >= start { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: start)).day ?? 0
        if days >= 1 { return Hi8Count(number: "\(days)", unit: days == 1 ? "DAY" : "DAYS", on: false) }
        let mins = Int(start.timeIntervalSince(now) / 60)
        if mins < 60 { return Hi8Count(number: "\(max(1, mins))", unit: "MIN", on: false) }
        let h = Int((Double(mins) / 60).rounded())
        return Hi8Count(number: "\(h)", unit: h == 1 ? "HOUR" : "HOURS", on: false)
    }
}

// MARK: - Timeline

struct Hi8Entry: TimelineEntry {
    let date: Date
    let feed: Hi8Feed?
    var count: Hi8Count? {
        guard let f = feed, let n = f.next else { return nil }
        return Hi8Count.make(now: date, start: f.time(n.start), end: f.time(n.end), tz: TimeZone(identifier: f.tz ?? "Europe/Amsterdam") ?? .current)
    }
}

struct Hi8Provider: TimelineProvider {
    func placeholder(in context: Context) -> Hi8Entry { Hi8Entry(date: .now, feed: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (Hi8Entry) -> Void) {
        if context.isPreview { completion(Hi8Entry(date: .now, feed: .sample)); return }
        Task { completion(Hi8Entry(date: .now, feed: await Hi8FeedLoader.load())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Hi8Entry>) -> Void) {
        Task {
            let feed = await Hi8FeedLoader.load()
            let now = Date.now
            var dates: [Date] = [now]
            if let f = feed, let n = f.next, let start = f.time(n.start) {
                let lastHour = start.addingTimeInterval(-3600)
                var t = now
                while t < now.addingTimeInterval(2 * 3600) && t < start {        // the next two hours
                    t = t < lastHour ? t.addingTimeInterval(15 * 60) : t.addingTimeInterval(60)
                    dates.append(t)
                }
                if let end = f.time(n.end) { dates.append(start); dates.append(end) } // ON NOW, then past
            }
            let entries = dates.filter { $0 >= now }.sorted().map { Hi8Entry(date: $0, feed: feed) }
            let again = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now
            completion(Timeline(entries: entries, policy: .after(again)))
        }
    }
}

// MARK: - Look (the canvas "Hi8ctane iPhone widget")

enum Hi8Color {
    static let deep = Color(red: 0.043, green: 0.133, blue: 0.200)   // #0B2233
    static let ink = Color(red: 0.067, green: 0.067, blue: 0.067)    // #111111
    static let cream = Color(red: 0.953, green: 0.937, blue: 0.890)  // #F3EFE3
    static let mute = Color(red: 0.663, green: 0.757, blue: 0.800)   // #A9C1CC
    static let lime = Color(red: 0.784, green: 1.0, blue: 0.239)     // #C8FF3D
    static let pink = Color(red: 1.0, green: 0.176, blue: 0.471)     // #FF2D78
    static let yellow = Color(red: 1.0, green: 0.882, blue: 0.302)   // #FFE14D
    static let dim = Color(red: 0.169, green: 0.290, blue: 0.365)    // #2B4A5D
    static let mint = Color(red: 0.553, green: 0.961, blue: 0.910)   // #8DF5E8

    static func tone(_ t: String) -> Color {
        switch t {
        case "epic": return pink
        case "good": return lime
        case "ok": return yellow
        default: return dim
        }
    }
}

extension Font {
    // Anton and Archivo Black ship in the widget target (Info.plist, "Fonts provided by application").
    static func hi8Big(_ s: CGFloat) -> Font { .custom("Anton-Regular", size: s) }
    static func hi8Word(_ s: CGFloat) -> Font { .custom("ArchivoBlack-Regular", size: s) }
    static func hi8Mono(_ s: CGFloat) -> Font { .system(size: s, weight: .bold, design: .monospaced) }
}

// MARK: - Pieces

struct Hi8Label: View {
    let text: String
    var color: Color = Hi8Color.mute
    var body: some View { Text(text).font(.hi8Mono(10)).tracking(0.6).foregroundStyle(color).lineLimit(1) }
}

struct Hi8Rating: View {
    let label: String, tone: String
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(Hi8Color.tone(tone)).frame(width: 9, height: 9)
            Text(label).font(.hi8Word(11)).foregroundStyle(Hi8Color.tone(tone))
        }
    }
}

struct Hi8Countdown: View {
    let count: Hi8Count?
    let size: CGFloat
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: size * 0.1) {
            Text(count?.number ?? "–").font(.hi8Big(size)).foregroundStyle(count?.on == true ? Hi8Color.pink : Hi8Color.lime)
            Text(count?.unit ?? "").font(.hi8Big(size * 0.33)).foregroundStyle(Hi8Color.cream)
        }
        .lineLimit(1).minimumScaleFactor(0.6)
    }
}

struct Hi8Arrow: View { // points where the wind blows to
    let dir: Int, size: CGFloat
    var body: some View {
        Image(systemName: "location.north.fill")
            .font(.system(size: size * 0.8, weight: .bold))
            .foregroundStyle(Hi8Color.cream)
            .rotationEffect(.degrees(Double((dir + 180) % 360)))
            .frame(width: size, height: size)
    }
}

struct Hi8Wind: View {
    let n: Hi8Next, size: CGFloat
    var body: some View {
        if let kt = n.kt {
            HStack(spacing: 4) {
                if let d = n.dir { Hi8Arrow(dir: d, size: size + 3) }
                Text("\(kt) KT \(n.compass ?? "")").font(.hi8Mono(size)).foregroundStyle(Hi8Color.cream)
            }
        }
    }
}

struct Hi8Faces: View {
    let n: Int, size: CGFloat, ring: Color
    var body: some View {
        HStack(spacing: -size / 4) {
            ForEach(0..<min(n, 3), id: \.self) { i in
                Circle().fill([Hi8Color.lime, Hi8Color.yellow, Hi8Color.mint][i])
                    .frame(width: size, height: size)
                    .overlay(Circle().stroke(ring, lineWidth: 2))
            }
        }
    }
}

// The week: height = how good the day is for your level, colour = the rating,
// the outlined bar = the day the countdown points to.
struct Hi8Week: View {
    let week: [Hi8Day]
    let at: Int?
    let barMax: CGFloat
    var knots = false
    var body: some View {
        HStack(alignment: .bottom, spacing: 5) {
            ForEach(Array(week.enumerated()), id: \.offset) { i, d in
                let mark = i == at
                VStack(spacing: 3) {
                    if (knots || mark), let kt = d.kt {
                        Text("\(kt)").font(.hi8Mono(10)).foregroundStyle(mark ? Hi8Color.lime : Hi8Color.mute)
                    }
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Hi8Color.tone(d.tone))
                        .frame(height: max(4, barMax * CGFloat(min(10, max(0, d.score))) / 10))
                        .overlay(mark ? RoundedRectangle(cornerRadius: 6).stroke(Hi8Color.lime, lineWidth: 2).padding(-4) : nil)
                    Text(d.day).font(.hi8Mono(10))
                        .foregroundStyle(i == 0 ? Hi8Color.lime : mark ? Hi8Color.cream : Hi8Color.mute)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Sizes

struct Hi8SmallView: View {
    let entry: Hi8Entry
    var body: some View {
        if let f = entry.feed, let n = f.next {
            VStack(alignment: .leading, spacing: 0) {
                HStack { Hi8Label(text: "\(f.sport.uppercased()) · NEXT"); Spacer(); Hi8Rating(label: n.label, tone: n.tone) }
                Hi8Countdown(count: entry.count, size: 64).padding(.top, 6)
                Text(entry.count?.on == true ? "UNTIL \(n.end.suffix(5))" : "\(n.day) \(n.start.suffix(5))")
                    .font(.hi8Mono(12)).foregroundStyle(Hi8Color.cream).padding(.top, 6)
                Spacer(minLength: 0)
                Text(n.spot.uppercased()).font(.hi8Word(15)).foregroundStyle(Hi8Color.cream).lineLimit(1).truncationMode(.tail)
                HStack {
                    Hi8Wind(n: n, size: 11)
                    Spacer()
                    Text(n.going > 0 ? "\(n.going) GOING" : "BE FIRST").font(.hi8Mono(11)).foregroundStyle(n.going > 0 ? Hi8Color.lime : Hi8Color.mute)
                }
                .padding(.top, 5)
            }
            .widgetURL(URL(string: n.url))
        } else {
            Hi8QuietView(feed: entry.feed, compact: true)
        }
    }
}

struct Hi8MediumView: View {
    let entry: Hi8Entry
    var body: some View {
        if let f = entry.feed, let n = f.next {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack { Hi8Label(text: "\(f.sport.uppercased()) · NEXT"); Spacer(); Hi8Rating(label: n.label, tone: n.tone) }
                    Hi8Countdown(count: entry.count, size: 56).padding(.top, 4)
                    Text(entry.count?.on == true ? "UNTIL \(n.end.suffix(5))" : "\(n.day) \(n.time)")
                        .font(.hi8Mono(11)).foregroundStyle(Hi8Color.cream).padding(.top, 4)
                    Spacer(minLength: 0)
                    Text(n.spot.uppercased()).font(.hi8Word(14)).foregroundStyle(Hi8Color.cream).lineLimit(1)
                    Text(n.going > 0 ? "\(n.going) going" + (n.seats > 0 ? " · \(n.seats) seats" : "") : "nobody yet · go first")
                        .font(.hi8Mono(11)).foregroundStyle(n.going > 0 ? Hi8Color.lime : Hi8Color.mute).padding(.top, 4)
                }
                .frame(width: 148)
                VStack(alignment: .leading, spacing: 0) {
                    HStack { Hi8Label(text: "THIS WEEK"); Spacer(); Hi8Wind(n: n, size: 10) }
                    Spacer(minLength: 0)
                    Hi8Week(week: f.week, at: n.at, barMax: 70)
                }
            }
            .widgetURL(URL(string: n.url))
        } else {
            Hi8QuietView(feed: entry.feed, compact: false)
        }
    }
}

struct Hi8LargeView: View {
    let entry: Hi8Entry
    var body: some View {
        if let f = entry.feed, let n = f.next {
            VStack(alignment: .leading, spacing: 0) {
                HStack { Hi8Label(text: "\(f.sport.uppercased()) · NEXT GOOD SESSION"); Spacer(); Hi8Rating(label: n.label, tone: n.tone) }
                HStack(alignment: .bottom) {
                    Hi8Countdown(count: entry.count, size: 76)
                    Spacer()
                    if let kt = n.kt {
                        VStack(spacing: 2) {
                            if let d = n.dir { Hi8Arrow(dir: d, size: 30) }
                            Text("\(kt) KT").font(.hi8Big(22)).foregroundStyle(Hi8Color.cream)
                            Text("\(n.compass ?? "")\(n.gust.map { " · GUSTS \($0)" } ?? "")").font(.hi8Mono(10)).foregroundStyle(Hi8Color.mute)
                        }
                    }
                }
                .padding(.top, 6)
                Text(n.spot.uppercased()).font(.hi8Word(18)).foregroundStyle(Hi8Color.cream).lineLimit(1).padding(.top, 8)
                Text((entry.count?.on == true ? "ON NOW · UNTIL \(n.end.suffix(5))" : "\(n.day) \(n.time)") + (n.kite.map { " · YOUR KITE \(Int($0)) M" } ?? ""))
                    .font(.hi8Mono(12)).foregroundStyle(Hi8Color.cream).padding(.top, 3)
                HStack(spacing: 10) {
                    if n.going > 0 { Hi8Faces(n: n.going, size: 28, ring: Hi8Color.deep) }
                    Text(n.going > 0 ? "\(n.going) going · \(n.seats > 0 ? "\(n.seats) seats left" : "meet there")" : "Nobody yet. Go first:\neveryone near you sees it.")
                        .font(.hi8Mono(12)).foregroundStyle(Hi8Color.cream)
                }
                .padding(.top, 12)
                Link(destination: URL(string: n.url)!) {
                    Text("I'M GOING").font(.hi8Word(15)).foregroundStyle(Hi8Color.ink)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Hi8Color.lime, in: Capsule())
                }
                .padding(.top, 12)
                Spacer(minLength: 0)
                Hi8Label(text: "THIS WEEK")
                Hi8Week(week: f.week, at: n.at, barMax: 54, knots: true).padding(.top, 6)
            }
            .widgetURL(URL(string: n.url))
        } else {
            Hi8QuietView(feed: entry.feed, compact: false)
        }
    }
}

// No good session in the next 7 days, or no data yet.
struct Hi8QuietView: View {
    let feed: Hi8Feed?
    let compact: Bool
    var body: some View {
        let week = feed?.week ?? []
        let best = week.indices.max(by: { week[$0].score < week[$1].score })
        VStack(alignment: .leading, spacing: 6) {
            Hi8Label(text: "\((feed?.sport ?? "kite").uppercased()) · NEXT GOOD DAY")
            if let b = best, week[b].score > 0 {
                Text("BEST: \(week[b].day)\(week[b].kt.map { " · \($0) KT" } ?? "")").font(.hi8Big(compact ? 24 : 30)).foregroundStyle(Hi8Color.lime)
            } else {
                Text(feed == nil ? "OPEN THE APP ONCE" : "NOTHING GOOD YET").font(.hi8Big(compact ? 22 : 28)).foregroundStyle(Hi8Color.cream)
            }
            Text("Nothing worth the drive this week yet.").font(.hi8Mono(10)).foregroundStyle(Hi8Color.mute)
            if !compact && !week.isEmpty { Spacer(minLength: 0); Hi8Week(week: week, at: best, barMax: 50, knots: true) }
        }
        .widgetURL(URL(string: "https://hi8ctane.com/"))
    }
}

// Lock screen, rectangular: the countdown, the place, the week as small bars.
struct Hi8LockView: View {
    let entry: Hi8Entry
    var body: some View {
        if let f = entry.feed, let n = f.next {
            let c = entry.count
            VStack(alignment: .leading, spacing: 2) {
                Text((c?.on == true ? "ON NOW" : "IN \(c?.number ?? "") \(c?.unit ?? "")") + (n.kt.map { " · \($0) KT" } ?? ""))
                    .font(.system(size: 15, weight: .heavy)).lineLimit(1)
                Text("\(n.day) \(n.start.suffix(5)) · \(n.spot)").font(.system(size: 12, weight: .semibold)).lineLimit(1)
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(f.week) { d in
                        RoundedRectangle(cornerRadius: 2)
                            .frame(height: max(3, 16 * CGFloat(d.score) / 10))
                            .opacity(d.score >= 6 ? 1 : 0.35)
                    }
                }
                .frame(height: 16, alignment: .bottom)
            }
            .widgetURL(URL(string: n.url))
        } else {
            Text("No good day yet").font(.system(size: 13, weight: .semibold))
        }
    }
}

// Lock screen, round: days (or hours) to go; the ring is how good it is.
struct Hi8CircleView: View {
    let entry: Hi8Entry
    var body: some View {
        if let f = entry.feed, let n = f.next {
            let c = entry.count, score = n.at.flatMap { f.week.indices.contains($0) ? f.week[$0].score : nil } ?? 0
            Gauge(value: score, in: 0...10) {
                EmptyView()
            } currentValueLabel: {
                VStack(spacing: 0) {
                    Text(c?.on == true ? "ON" : "\(c?.number ?? "")\(c?.unit.prefix(1) ?? "")").font(.system(size: 20, weight: .heavy))
                    Text(n.day.prefix(3)).font(.system(size: 9, weight: .bold))
                }
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .widgetURL(URL(string: n.url))
        } else {
            Image(systemName: "wind")
        }
    }
}

struct Hi8WidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: Hi8Entry
    var body: some View {
        switch family {
        case .systemSmall: Hi8SmallView(entry: entry)
        case .systemLarge: Hi8LargeView(entry: entry)
        case .accessoryRectangular: Hi8LockView(entry: entry)
        case .accessoryCircular: Hi8CircleView(entry: entry)
        default: Hi8MediumView(entry: entry)
        }
    }
}

// MARK: - Widget

@main
struct Hi8Widget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Hi8NextSession", provider: Hi8Provider()) { entry in
            Hi8WidgetView(entry: entry)
                .containerBackground(for: .widget) { Hi8Color.deep }
        }
        .configurationDisplayName("Next good session")
        .description("A countdown to the next good day at your spots, the week, and who's going.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular])
    }
}

// MARK: - Sample (the widget gallery only)

extension Hi8Feed {
    static var sample: Hi8Feed {
        let days = ["WED", "THU", "FRI", "SAT", "SUN", "MON", "TUE"]
        let tones = ["no", "ok", "no", "epic", "good", "no", "ok"]
        let scores = [2.1, 4.5, 1.0, 9.2, 7.1, 2.5, 4.8]
        let kts = [8, 14, 7, 22, 17, 9, 13]
        let start = Date.now.addingTimeInterval(3 * 86400)
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let d = f.string(from: start)
        return Hi8Feed(
            v: 1, city: "amsterdam", sport: "kite", tz: TimeZone.current.identifier,
            next: Hi8Next(date: d, start: "\(d)T08:00", end: "\(d)T12:00", day: "SAT", time: "08–12", spot: "IJmuiden", slug: "ijmuiden",
                          label: "EPIC", tone: "epic", kt: 22, gust: 27, dir: 225, compass: "SW", kite: 9, going: 3, seats: 2,
                          crew: nil, url: "https://hi8ctane.com/", at: 3),
            week: (0..<7).map { i in Hi8Day(date: "d\(i)", day: days[i], label: tones[i].uppercased(), tone: tones[i], score: scores[i], kt: kts[i], going: 0) }
        )
    }
}
