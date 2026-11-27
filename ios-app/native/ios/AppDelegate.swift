import UIKit
import UserNotifications
import Capacitor

// Hi8ctane: Capacitor's AppDelegate, plus the notification buttons.
// The alert worker sends a "category" with each push; iOS shows that category's buttons on the lock screen.
//   crew   : I'M IN · A SEAT / I'M IN · MEETING THERE / NOT NOW   (a crew that fits, a proposal)
//   recheck: STILL IN / I'M OUT                                   (the evening before)
//   spot   : ON / MEH / OFF                                       (at the spot: how is it?)
// A tap on a button opens the app for a moment and native.js sends the answer (pushNotificationActionPerformed).
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let fg: UNNotificationActionOptions = [.foreground]
        let crew = UNNotificationCategory(identifier: "crew", actions: [
            UNNotificationAction(identifier: "in_seat", title: "I'M IN · A SEAT", options: fg),
            UNNotificationAction(identifier: "in_own", title: "I'M IN · MEETING THERE", options: fg),
            UNNotificationAction(identifier: "not_now", title: "NOT NOW", options: [])
        ], intentIdentifiers: [], options: [])
        let recheck = UNNotificationCategory(identifier: "recheck", actions: [
            UNNotificationAction(identifier: "still_in", title: "STILL IN", options: fg),
            UNNotificationAction(identifier: "out", title: "I'M OUT", options: [.foreground, .destructive])
        ], intentIdentifiers: [], options: [])
        let spot = UNNotificationCategory(identifier: "spot", actions: [
            UNNotificationAction(identifier: "on", title: "ON", options: fg),
            UNNotificationAction(identifier: "meh", title: "MEH", options: fg),
            UNNotificationAction(identifier: "off", title: "OFF", options: fg)
        ], intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([crew, recheck, spot])
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
}
