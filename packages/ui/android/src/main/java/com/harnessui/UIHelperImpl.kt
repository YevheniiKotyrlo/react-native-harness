package com.harnessui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * UI helper implementation for HarnessUI.
 * Includes touch simulation and view querying capabilities.
 */
class UIHelperImpl(
    private val context: ReactApplicationContext,
) {
    companion object {
        private const val TAG = "HarnessUI"
        private const val TAP_DURATION_MS = 50L // Duration between touch down and up
        private const val EVENT_PROCESSING_DELAY_MS = 10L // Delay after touch up for React Native to process the event
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    // =========================================================================
    // Touch Simulation
    // =========================================================================

    fun simulatePress(
        nativeId: String,
        x: Double,
        y: Double,
        promise: Promise,
    ) {
        Log.i(TAG, "simulatePress called with nativeId:$nativeId x:$x y:$y")

        UiThreadUtil.runOnUiThread {
            val activity =
                context.currentActivity ?: run {
                    Log.w(TAG, "No current activity")
                    promise.resolve(null)
                    return@runOnUiThread
                }
            val root = activity.window.decorView
            val density = root.resources.displayMetrics.density

            var targetX = x
            var targetY = y

            // If nativeId is provided, try to find the view and get its current position
            if (nativeId.isNotEmpty()) {
                val targetView = ViewRegistry.get(nativeId)
                if (targetView != null) {
                    val location = IntArray(2)
                    targetView.getLocationOnScreen(location)
                    // Calculate center in DP
                    val viewX = location[0] / density
                    val viewY = location[1] / density
                    val viewW = targetView.width / density
                    val viewH = targetView.height / density

                    targetX = (viewX + viewW / 2.0)
                    targetY = (viewY + viewH / 2.0)
                    Log.i(TAG, "Resolved view $nativeId to coordinates ($targetX, $targetY)")
                } else {
                    Log.w(TAG, "View with nativeId $nativeId not found or collected. Using provided coordinates.")
                }
            }

            // Convert DP to PX
            val pxX = (targetX * density).toFloat()
            val pxY = (targetY * density).toFloat()

            val downTime = SystemClock.uptimeMillis()

            // 1. ACTION_DOWN
            val downEvent = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, pxX, pxY, 0)
            try {
                root.dispatchTouchEvent(downEvent)
                Log.i(TAG, "Sent touch down at ($pxX, $pxY)")
            } finally {
                downEvent.recycle()
            }

            // 2. ACTION_UP after real delay to allow press feedback to render
            mainHandler.postDelayed({
                val upTime = SystemClock.uptimeMillis()
                val upEvent = MotionEvent.obtain(downTime, upTime, MotionEvent.ACTION_UP, pxX, pxY, 0)
                try {
                    root.dispatchTouchEvent(upEvent)
                    Log.i(TAG, "Tap completed at ($pxX, $pxY)")
                } finally {
                    upEvent.recycle()
                }
                // Wait for React Native to process the touch event and trigger JS callbacks
                mainHandler.postDelayed({
                    promise.resolve(null)
                }, EVENT_PROCESSING_DELAY_MS)
            }, TAP_DURATION_MS)
        }
    }

    // =========================================================================
    // Query API
    // =========================================================================

    fun queryByTestId(testId: String): WritableMap? {
        Log.i(TAG, "queryByTestId called with: $testId")
        return executeQuery(ViewQueryType.TEST_ID, testId)
    }

    fun queryByAccessibilityLabel(label: String): WritableMap? {
        Log.i(TAG, "queryByAccessibilityLabel called with: $label")
        return executeQuery(ViewQueryType.ACCESSIBILITY_LABEL, label)
    }

    fun queryAllByTestId(testId: String): WritableArray {
        Log.i(TAG, "queryAllByTestId called with: $testId")
        return executeQueryAll(ViewQueryType.TEST_ID, testId)
    }

    fun queryAllByAccessibilityLabel(label: String): WritableArray {
        Log.i(TAG, "queryAllByAccessibilityLabel called with: $label")
        return executeQueryAll(ViewQueryType.ACCESSIBILITY_LABEL, label)
    }

    /**
     * Executes a query on the UI thread and returns the result.
     * Uses CountDownLatch to synchronize with the UI thread.
     */
    private fun executeQuery(
        queryType: ViewQueryType,
        value: String,
    ): WritableMap? {
        var result: WritableMap? = null

        // If already on UI thread, execute directly
        if (UiThreadUtil.isOnUiThread()) {
            val activity = context.currentActivity ?: return null
            result = ViewQueryHelper.query(activity, queryType, value)?.toWritableMap()
        } else {
            // Execute on UI thread and wait for result
            val latch = CountDownLatch(1)

            UiThreadUtil.runOnUiThread {
                try {
                    val activity = context.currentActivity
                    if (activity != null) {
                        result = ViewQueryHelper.query(activity, queryType, value)?.toWritableMap()
                    }
                } finally {
                    latch.countDown()
                }
            }

            // Wait for UI thread with timeout
            try {
                latch.await(5, TimeUnit.SECONDS)
            } catch (e: InterruptedException) {
                Log.e(TAG, "Query interrupted", e)
            }
        }

        Log.i(TAG, "Query result: $result")
        return result
    }

    /**
     * Executes a query for all matching views on the UI thread.
     * Uses CountDownLatch to synchronize with the UI thread.
     */
    private fun executeQueryAll(
        queryType: ViewQueryType,
        value: String,
    ): WritableArray {
        var result: WritableArray = Arguments.createArray()

        // If already on UI thread, execute directly
        if (UiThreadUtil.isOnUiThread()) {
            val activity = context.currentActivity ?: return result
            val queryResults = ViewQueryHelper.queryAll(activity, queryType, value)
            result =
                Arguments.createArray().apply {
                    queryResults.forEach { pushMap(it.toWritableMap()) }
                }
        } else {
            // Execute on UI thread and wait for result
            val latch = CountDownLatch(1)

            UiThreadUtil.runOnUiThread {
                try {
                    val activity = context.currentActivity
                    if (activity != null) {
                        val queryResults = ViewQueryHelper.queryAll(activity, queryType, value)
                        result =
                            Arguments.createArray().apply {
                                queryResults.forEach { pushMap(it.toWritableMap()) }
                            }
                    }
                } finally {
                    latch.countDown()
                }
            }

            // Wait for UI thread with timeout
            try {
                latch.await(5, TimeUnit.SECONDS)
            } catch (e: InterruptedException) {
                Log.e(TAG, "QueryAll interrupted", e)
            }
        }

        Log.i(TAG, "QueryAll result count: ${result.size()}")
        return result
    }

    // =========================================================================
    // Screenshot Capture
    // =========================================================================

    fun captureScreenshot(
        bounds: ReadableMap?,
        promise: Promise,
    ) {
        Log.i(TAG, "captureScreenshot called")

        UiThreadUtil.runOnUiThread {
            val activity =
                context.currentActivity ?: run {
                    Log.w(TAG, "No current activity")
                    promise.resolve(null)
                    return@runOnUiThread
                }

            val window = activity.window
            val root = window.decorView.rootView
            val density = root.resources.displayMetrics.density

            try {
                // Check if we have a specific view to capture via nativeId
                val nativeId = if (bounds != null && bounds.hasKey("nativeId")) bounds.getString("nativeId") else null

                if (!nativeId.isNullOrEmpty()) {
                    val targetView = ViewRegistry.get(nativeId)
                    if (targetView != null) {
                        val width = targetView.width
                        val height = targetView.height

                        if (width > 0 && height > 0) {
                            val location = IntArray(2)
                            targetView.getLocationInWindow(location)
                            val viewRect = Rect(location[0], location[1], location[0] + width, location[1] + height)
                            val rootRect = Rect(0, 0, root.width, root.height)

                            if (rootRect.contains(viewRect)) {
                                Log.i(TAG, "View $nativeId is fully on screen. Using screen-based screenshotting.")
                                captureWindowRegion(window, viewRect, promise)
                            } else {
                                Log.i(TAG, "View $nativeId is partially/fully off screen. Using direct view render.")
                                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                                targetView.draw(Canvas(bitmap))
                                promise.resolve(encodePng(bitmap))
                            }
                            return@runOnUiThread
                        }
                    } else {
                        Log.w(TAG, "View with nativeId $nativeId not found for screenshot, falling back to window screenshot")
                    }
                }

                // Check if bounds are provided and have non-zero dimensions
                val hasBounds = bounds != null && bounds.getDouble("width") > 0 && bounds.getDouble("height") > 0

                val region =
                    if (hasBounds) {
                        // Convert dp to px for bounds
                        val captureX = (bounds!!.getDouble("x") * density).toInt()
                        val captureY = (bounds.getDouble("y") * density).toInt()
                        val captureWidth = (bounds.getDouble("width") * density).toInt()
                        val captureHeight = (bounds.getDouble("height") * density).toInt()
                        Log.i(TAG, "Capturing region: x=$captureX y=$captureY w=$captureWidth h=$captureHeight")
                        Rect(captureX, captureY, captureX + captureWidth, captureY + captureHeight)
                    } else {
                        Log.i(TAG, "Capturing full window: w=${root.width} h=${root.height}")
                        Rect(0, 0, root.width, root.height)
                    }

                captureWindowRegion(window, region, promise)
            } catch (e: Exception) {
                Log.e(TAG, "Screenshot capture failed", e)
                promise.resolve(null)
            }
        }
    }

    // A software draw of the view tree leaves out pixels a view keeps on a surface of its own: a TextureView draws
    // nothing into a software canvas, and a SurfaceView's content lives on a separate surface behind the window.
    // PixelCopy reads the window's surface, which the TextureViews render into, and each SurfaceView's surface.
    private fun captureWindowRegion(
        window: Window,
        region: Rect,
        promise: Promise,
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            val bitmap = Bitmap.createBitmap(region.width(), region.height(), Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.translate(-region.left.toFloat(), -region.top.toFloat())
            window.decorView.rootView.draw(canvas)
            promise.resolve(encodePng(bitmap))
            return
        }

        val windowPixels = Bitmap.createBitmap(region.width(), region.height(), Bitmap.Config.ARGB_8888)
        PixelCopy.request(window, region, windowPixels, { windowResult ->
            if (windowResult != PixelCopy.SUCCESS) {
                Log.e(TAG, "PixelCopy of the window failed with result $windowResult")
                windowPixels.recycle()
                promise.resolve(null)
                return@request
            }

            val surfaceViews = collectSurfaceViews(window.decorView).filter { surfaceView ->
                Rect.intersects(region, rectInWindow(surfaceView))
            }
            copySurfaceViews(surfaceViews, region) { surfaceLayers ->
                if (surfaceLayers == null) {
                    windowPixels.recycle()
                    promise.resolve(null)
                    return@copySurfaceViews
                }
                val screenshot = Bitmap.createBitmap(region.width(), region.height(), Bitmap.Config.ARGB_8888)
                val canvas = Canvas(screenshot)
                // A SurfaceView's surface sits behind its window, which leaves a transparent hole over it.
                surfaceLayers.forEach { layer ->
                    canvas.drawBitmap(layer.pixels, layer.left, layer.top, null)
                    layer.pixels.recycle()
                }
                canvas.drawBitmap(windowPixels, 0f, 0f, null)
                windowPixels.recycle()
                promise.resolve(encodePng(screenshot))
            }
        }, mainHandler)
    }

    private class SurfaceLayer(
        val pixels: Bitmap,
        val left: Float,
        val top: Float,
    )

    // Copies each SurfaceView's surface in turn and hands back its layers, or null if a copy failed. A surface with no
    // frame yet shows nothing on screen, so it adds no layer.
    private fun copySurfaceViews(
        surfaceViews: List<SurfaceView>,
        region: Rect,
        onCopied: (List<SurfaceLayer>?) -> Unit,
    ) {
        val layers = mutableListOf<SurfaceLayer>()

        fun copyFrom(index: Int) {
            if (index == surfaceViews.size) {
                onCopied(layers)
                return
            }
            val surfaceView = surfaceViews[index]
            val surfaceRect = rectInWindow(surfaceView)
            val pixels = Bitmap.createBitmap(surfaceRect.width(), surfaceRect.height(), Bitmap.Config.ARGB_8888)
            PixelCopy.request(surfaceView, pixels, { surfaceResult ->
                when (surfaceResult) {
                    PixelCopy.SUCCESS -> {
                        layers.add(
                            SurfaceLayer(
                                pixels,
                                (surfaceRect.left - region.left).toFloat(),
                                (surfaceRect.top - region.top).toFloat(),
                            ),
                        )
                        copyFrom(index + 1)
                    }
                    PixelCopy.ERROR_SOURCE_NO_DATA -> {
                        pixels.recycle()
                        copyFrom(index + 1)
                    }
                    else -> {
                        Log.e(TAG, "PixelCopy of a SurfaceView failed with result $surfaceResult")
                        pixels.recycle()
                        layers.forEach { layer -> layer.pixels.recycle() }
                        onCopied(null)
                    }
                }
            }, mainHandler)
        }

        copyFrom(0)
    }

    private fun collectSurfaceViews(view: View): List<SurfaceView> =
        when {
            !view.isShown -> emptyList()
            view is SurfaceView ->
                if (view.width > 0 && view.height > 0 && view.holder.surface.isValid) listOf(view) else emptyList()
            view is ViewGroup -> (0 until view.childCount).flatMap { index -> collectSurfaceViews(view.getChildAt(index)) }
            else -> emptyList()
        }

    private fun rectInWindow(view: View): Rect {
        val location = IntArray(2)
        view.getLocationInWindow(location)
        return Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
    }

    private fun encodePng(bitmap: Bitmap): String {
        val outputStream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
        bitmap.recycle()
        Log.i(TAG, "Screenshot captured successfully (${outputStream.size()} bytes)")
        return android.util.Base64.encodeToString(outputStream.toByteArray(), android.util.Base64.NO_WRAP)
    }

    // =========================================================================
    // Text Input
    // =========================================================================

    fun typeChar(
        character: String,
        promise: Promise,
    ) {
        Log.i(TAG, "typeChar called with: $character")

        UiThreadUtil.runOnUiThread {
            val activity =
                context.currentActivity ?: run {
                    Log.w(TAG, "No current activity")
                    promise.resolve(null)
                    return@runOnUiThread
                }

            val focused = activity.currentFocus
            if (focused is EditText) {
                // Insert character at cursor position
                val start = focused.selectionStart
                val end = focused.selectionEnd
                focused.text.replace(start, end, character)
                Log.i(TAG, "Inserted character: $character")
            } else {
                Log.i(TAG, "No EditText is focused")
            }

            // Delay for React Native to process onChangeText
            mainHandler.postDelayed({
                promise.resolve(null)
            }, EVENT_PROCESSING_DELAY_MS)
        }
    }

    fun blur(
        options: ReadableMap,
        promise: Promise,
    ) {
        val submitEditing = options.getBoolean("submitEditing")
        Log.i(TAG, "blur called, submitEditing: $submitEditing")

        UiThreadUtil.runOnUiThread {
            val activity =
                context.currentActivity ?: run {
                    Log.w(TAG, "No current activity")
                    promise.resolve(null)
                    return@runOnUiThread
                }

            val focused = activity.currentFocus

            if (submitEditing && focused is EditText) {
                Log.i(TAG, "Triggering submitEditing")
                // Trigger onSubmitEditing by simulating IME action
                focused.onEditorAction(EditorInfo.IME_ACTION_DONE)
            }

            if (focused != null) {
                // Clear focus (triggers onEndEditing and onBlur)
                Log.i(TAG, "Clearing focus")
                focused.clearFocus()

                // Hide keyboard
                val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.hideSoftInputFromWindow(focused.windowToken, 0)
            } else {
                Log.i(TAG, "No view is focused")
            }

            mainHandler.postDelayed({
                promise.resolve(null)
            }, EVENT_PROCESSING_DELAY_MS)
        }
    }
}
