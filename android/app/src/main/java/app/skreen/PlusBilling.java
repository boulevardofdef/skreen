package app.skreen;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONObject;

import java.util.List;

/**
 * Skreen Plus through Google Play Billing: one subscription product.
 *
 * Create a subscription with PRODUCT_ID in the Play Console (one base plan). Without Play
 * (a sideloaded build) setup simply fails and the answer stays "not subscribed".
 * The last known answer is cached so Plus keeps working offline.
 */
final class PlusBilling implements com.android.billingclient.api.PurchasesUpdatedListener {
    static final String PRODUCT_ID = "skreen_plus";

    interface Listener { void onChanged(String json); }

    private final Context context;
    private final SharedPreferences prefs;
    private final Listener listener;
    private BillingClient client;
    private ProductDetails details;
    private String price = "";

    PlusBilling(Context context, SharedPreferences prefs, Listener listener) {
        this.context = context;
        this.prefs = prefs;
        this.listener = listener;
    }

    void start() {
        client = BillingClient.newBuilder(context)
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
        connect();
    }

    private void connect() {
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult result) {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) return;
                refreshPurchases();
                loadPrice();
            }
            @Override public void onBillingServiceDisconnected() { /* retried on the next resume */ }
        });
    }

    void end() { if (client != null) client.endConnection(); }

    /** Called when the app comes back to the front: picks up purchases made elsewhere. */
    void resume() {
        if (client == null) return;
        if (client.isReady()) refreshPurchases(); else connect();
    }

    String json() {
        try {
            return new JSONObject()
                    .put("play", prefs.getBoolean("plus", false))
                    .put("price", price)
                    .put("canBuy", details != null)
                    .toString();
        } catch (Exception e) { return "{}"; }
    }

    private void changed() { listener.onChanged(json()); }

    private void loadPrice() {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(java.util.Collections.singletonList(
                        QueryProductDetailsParams.Product.newBuilder()
                                .setProductId(PRODUCT_ID)
                                .setProductType(BillingClient.ProductType.SUBS)
                                .build()))
                .build();
        client.queryProductDetailsAsync(params, (result, list) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || list.isEmpty()) return;
            details = list.get(0);
            List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
            if (offers != null && !offers.isEmpty()) {
                List<ProductDetails.PricingPhase> phases = offers.get(0).getPricingPhases().getPricingPhaseList();
                if (!phases.isEmpty()) price = phases.get(phases.size() - 1).getFormattedPrice();
            }
            changed();
        });
    }

    private void refreshPurchases() {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
                (result, purchases) -> {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) apply(purchases);
                });
    }

    private void apply(List<Purchase> purchases) {
        boolean active = false;
        for (Purchase p : purchases) {
            if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED || !p.getProducts().contains(PRODUCT_ID)) continue;
            active = true;
            if (!p.isAcknowledged()) {
                client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(), r -> { });
            }
        }
        prefs.edit().putBoolean("plus", active).apply();
        changed();
    }

    void buy(Activity activity) {
        if (client == null || details == null) return;
        List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
        if (offers == null || offers.isEmpty()) return;
        BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(java.util.Collections.singletonList(
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                                .setProductDetails(details)
                                .setOfferToken(offers.get(0).getOfferToken())
                                .build()))
                .build();
        client.launchBillingFlow(activity, params);
    }

    @Override public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) apply(purchases);
    }
}
