// Hi8ctane home-screen widget (WidgetKit, iOS 17+).
// Shows the next good session for the rider's region and sport, and who's going.
// A tap opens that session in the app, ready for I'M GOING.
//
// Data: one small JSON from the widget feed (supabase/functions/widget), refreshed about every 30 minutes.
// Settings (region, sport, weight) come from the app through the shared App Group; see Hi8Bridge.swift.
//
// NOT YET BUILT OR RUN: this file was written without Xcode. Expect small compile fixes on the first build.

import SwiftUI
import WidgetKit

// MARK: - Shared settings

enum Hi8Shared {
    static let group = "group.com.hi8ctane.app"
    static let feedBase = "https://YOUR-PROJECT.supabase.co/functions/v1/widget" // set to the project's function URL
    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }
    static var city: String { defaults.string(forKey: "city") ?? "amsterdam" }
    static var sport: String { defaults.string(forKey: "sport") ?? "kite" }
    static var kg: Int { let v = defaults.integer(forKey: "kg"); return v > 0 ? v : 75 }
}

// MARK: - Feed

struct Hi8Next: Codable {
    let date: String, day: String, time: String, spot: String, slug: String
    let label: String, tone: String
    let kt: Int?, gust: Int?, dir: Int?, compass: String?
    let kite: Double?
    let going: Int, seats: Int
    let crew: String?
    let url: String
}

struct Hi8Day: Codable, Identifiable {
    let date: String, day: String, label: String, tone: String
    let kt: Int?
    let going: Int
    var id: String { date }
}

struct Hi8Feed: Codable {
    let v: Int
    let city: String, sport: String
    let next: Hi8Next?
    let week: [Hi8Day]
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

// MARK: - Timeline

struct Hi8Entry: TimelineEntry {
    let date: Date
    let feed: Hi8Feed?
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
            let again = Calendar.current.date(byAdding: .minute, value: 30, to: .now) ?? .now
            completion(Timeline(entries: [Hi8Entry(date: .now, feed: feed)], policy: .after(again)))
        }
    }
}

// MARK: - Look

enum Hi8Color {
    static let ink = Color(red: 0.067, green: 0.067, blue: 0.067)
    static let cream = Color(red: 0.953, green: 0.937, blue: 0.890)
    static let lime = Color(red: 0.784, green: 1.0, blue: 0.239)
    static let pink = Color(red: 1.0, green: 0.176, blue: 0.471)
    static let yellow = Color(red: 1.0, green: 0.882, blue: 0.302)
    static let sand = Color(red: 0.906, green: 0.886, blue: 0.831)
    static let steel = Color(red: 0.184, green: 0.459, blue: 0.545)

    static func tone(_ t: String) -> Color {
        switch t {
        case "epic": return pink
        case "good": return lime
        case "ok": return yellow
        default: return sand
        }
    }
}

extension Font {
    // Anton and Archivo Black ship in the widget target (Info.plist, "Fonts provided by application").
    static func hi8Big(_ size: CGFloat) -> Font { .custom("Anton-Regular", size: size) }
    static func hi8Word(_ size: CGFloat) -> Font { .custom("ArchivoBlack-Regular", size: size) }
    static func hi8Mono(_ size: CGFloat) -> Font { .system(size: size, weight: .bold, design: .monospaced) }
}

struct Hi8Tag: View {
    let label: String, tone: String
    var body: some View {
        Text(label)
            .font(.hi8Word(10))
            .foregroundStyle(Hi8Color.ink)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(Hi8Color.tone(tone))
    }
}

// MARK: - Views

struct Hi8SmallView: View {
    let next: Hi8Next?
    var body: some View {
        if let n = next {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(n.day).font(.hi8Mono(11)).foregroundStyle(Hi8Color.cream)
                    Spacer()
                    Hi8Tag(label: n.label, tone: n.tone)
                }
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(n.kt.map(String.init) ?? "GO").font(.hi8Big(54)).foregroundStyle(Hi8Color.lime)
                    if n.kt != nil { Text("KT \(n.compass ?? "")").font(.hi8Big(18)).foregroundStyle(Hi8Color.cream) }
                }
                Text(n.spot.uppercased()).font(.hi8Word(13)).foregroundStyle(Hi8Color.cream).lineLimit(1).minimumScaleFactor(0.7)
                Text(n.time).font(.hi8Mono(11)).foregroundStyle(Hi8Color.cream)
                Spacer(minLength: 0)
                Text(n.going > 0 ? "\(n.going) GOING" : "BE THE FIRST")
                    .font(.hi8Word(11)).foregroundStyle(Hi8Color.ink)
                    .frame(maxWidth: .infinity).padding(.vertical, 5)
                    .background(Hi8Color.lime)
            }
            .widgetURL(URL(string: n.url))
        } else {
            Hi8EmptyView()
        }
    }
}

struct Hi8MediumView: View {
    let feed: Hi8Feed?
    var body: some View {
        if let n = feed?.next {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text("\(n.day) \(n.time)").font(.hi8Mono(11)).foregroundStyle(Hi8Color.cream)
                        Hi8Tag(label: n.label, tone: n.tone)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(n.kt.map(String.init) ?? "GO").font(.hi8Big(56)).foregroundStyle(Hi8Color.lime)
                        if n.kt != nil { Text("KT \(n.compass ?? "")").font(.hi8Big(18)).foregroundStyle(Hi8Color.cream) }
                    }
                    Text(n.spot.uppercased()).font(.hi8Word(15)).foregroundStyle(Hi8Color.cream).lineLimit(1).minimumScaleFactor(0.7)
                    if let k = n.kite { Text("YOUR KITE: \(Int(k)) M").font(.hi8Mono(10)).foregroundStyle(Hi8Color.cream) }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(n.going > 0 ? "\(n.going) GOING" : "NOBODY YET").font(.hi8Word(14)).foregroundStyle(Hi8Color.cream)
                    Text(n.going > 0 ? (n.seats > 0 ? "\(n.seats) SEATS LEFT" : "MEET THERE") : "GO FIRST: EVERYONE NEAR YOU SEES IT")
                        .font(.hi8Mono(10)).foregroundStyle(Hi8Color.cream).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Text("I'M GOING").font(.hi8Word(14)).foregroundStyle(Hi8Color.ink)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(Hi8Color.lime)
                }
            }
            .widgetURL(URL(string: n.url))
        } else {
            Hi8EmptyView(week: feed?.week ?? [])
        }
    }
}

struct Hi8WeekStrip: View {
    let week: [Hi8Day]
    var body: some View {
        HStack(spacing: 3) {
            ForEach(week) { d in
                VStack(spacing: 1) {
                    Text(d.day).font(.hi8Mono(8))
                    Text(d.kt.map(String.init) ?? "–").font(.hi8Word(11))
                }
                .foregroundStyle(Hi8Color.ink)
                .frame(maxWidth: .infinity).padding(.vertical, 4)
                .background(Hi8Color.tone(d.tone))
            }
        }
    }
}

struct Hi8LargeView: View {
    let feed: Hi8Feed?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Hi8MediumView(feed: feed)
            Text("THE WEEK").font(.hi8Word(11)).foregroundStyle(Hi8Color.cream)
            Hi8WeekStrip(week: feed?.week ?? [])
        }
    }
}

struct Hi8EmptyView: View {
    var week: [Hi8Day] = []
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NO GOOD DAY YET").font(.hi8Big(26)).foregroundStyle(Hi8Color.cream)
            Text("We'll show the next one here.").font(.hi8Mono(10)).foregroundStyle(Hi8Color.cream)
            if !week.isEmpty { Hi8WeekStrip(week: week) }
        }
        .widgetURL(URL(string: "https://hi8ctane.com/"))
    }
}

// Lock screen: one line of wind, one of place and people.
struct Hi8LockView: View {
    let next: Hi8Next?
    var body: some View {
        if let n = next {
            VStack(alignment: .leading, spacing: 1) {
                Text("\(n.kt.map { "\($0) KT " } ?? "")\(n.compass ?? "") · \(n.label)").font(.system(size: 14, weight: .heavy))
                Text("\(n.spot) · \(n.day) \(n.time)").font(.system(size: 11, weight: .semibold)).lineLimit(1)
                Text(n.going > 0 ? "\(n.going) going" : "Be the first").font(.system(size: 11))
            }
            .widgetURL(URL(string: n.url))
        } else {
            Text("No good day yet").font(.system(size: 12, weight: .semibold))
        }
    }
}

struct Hi8WidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: Hi8Entry
    var body: some View {
        switch family {
        case .systemSmall: Hi8SmallView(next: entry.feed?.next)
        case .systemLarge: Hi8LargeView(feed: entry.feed)
        case .accessoryRectangular: Hi8LockView(next: entry.feed?.next)
        default: Hi8MediumView(feed: entry.feed)
        }
    }
}

// MARK: - Widget

@main
struct Hi8Widget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Hi8NextSession", provider: Hi8Provider()) { entry in
            Hi8WidgetView(entry: entry)
                .containerBackground(for: .widget) { Hi8Color.steel }
        }
        .configurationDisplayName("Next good session")
        .description("The next good day at your spots, and who's going.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}

// MARK: - Sample (the widget gallery only)

extension Hi8Feed {
    static let sample = Hi8Feed(
        v: 1, city: "amsterdam", sport: "kite",
        next: Hi8Next(date: "2026-01-01", day: "TODAY", time: "11–15", spot: "IJmuiden", slug: "ijmuiden", label: "EPIC", tone: "epic",
                      kt: 22, gust: 27, dir: 225, compass: "SW", kite: 9, going: 3, seats: 2, crew: nil, url: "https://hi8ctane.com/"),
        week: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].enumerated().map { i, d in
            Hi8Day(date: "d\(i)", day: d, label: "GOOD", tone: ["epic", "ok", "no", "good", "good", "no", "ok"][i], kt: [22, 14, 7, 19, 17, 9, 13][i], going: 0)
        }
    )
}
