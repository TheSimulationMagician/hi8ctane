// Capacitor plugin (app target): the web app tells the widget which region, sport and weight to show.
// From JavaScript:  Capacitor.Plugins.Hi8Bridge.set({ city: 'amsterdam', sport: 'kite', kg: 75 })
//
// NOT YET BUILT OR RUN: written without Xcode. Expect small compile fixes on the first build.

import Capacitor
import Foundation
import WidgetKit

@objc(Hi8Bridge)
public class Hi8Bridge: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "Hi8Bridge"
    public let jsName = "Hi8Bridge"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)]

    @objc func set(_ call: CAPPluginCall) {
        let d = UserDefaults(suiteName: "group.com.hi8ctane.app") ?? .standard
        if let city = call.getString("city") { d.set(city, forKey: "city") }
        if let sport = call.getString("sport") { d.set(sport, forKey: "sport") }
        if let kg = call.getInt("kg") { d.set(kg, forKey: "kg") }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
