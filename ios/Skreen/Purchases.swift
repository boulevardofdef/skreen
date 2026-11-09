import Foundation
import StoreKit

/// Skreen+ as a one-time App Store purchase (a "non-consumable" product).
@MainActor
final class Purchases {
    static let productID = "skreen_plus"
    private var product: Product?
    private(set) var owned = false
    private var updates: Task<Void, Never>?
    var onChange: (() -> Void)?

    var json: [String: Any] {
        ["play": owned, "price": product?.displayPrice ?? "", "canBuy": product != nil]
    }

    func start() {
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let t) = result { await t.finish() }
                await self?.refresh()
            }
        }
        Task { await load(); await refresh() }
    }

    private func load() async {
        product = try? await Product.products(for: [Purchases.productID]).first
        onChange?()
    }

    /// Whether this Apple ID owns Skreen+ (the App Store keeps the record).
    func refresh() async {
        var has = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.productID == Purchases.productID, t.revocationDate == nil { has = true }
        }
        owned = has
        onChange?()
    }

    func buy() async {
        if product == nil { await load() }
        guard let product = product else { return }
        if let result = try? await product.purchase(), case .success(let verification) = result, case .verified(let t) = verification {
            await t.finish()
        }
        await refresh()
    }

    /// "Restore purchase": asks the App Store to sync, then checks again.
    func restore() async {
        try? await AppStore.sync()
        await refresh()
    }
}
