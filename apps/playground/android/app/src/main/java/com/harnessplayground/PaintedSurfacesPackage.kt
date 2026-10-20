package com.harnessplayground

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.SurfaceTexture
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.TextureView
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager

// Views whose pixels live on a surface of their own, as a GPU-rendered view's
// do. Each paints its frame from the CPU and labels itself once that frame is
// what it shows.

class SolidColorTextureView(context: Context) :
  TextureView(context),
  TextureView.SurfaceTextureListener {
  init {
    surfaceTextureListener = this
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
    val canvas = lockCanvas() ?: return
    canvas.drawColor(Color.RED)
    unlockCanvasAndPost(canvas)
  }

  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
    contentDescription = PAINTED_LABEL
  }

  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}

  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture) = true

  companion object {
    const val PAINTED_LABEL = "texture-view-painted"
  }
}

class SolidColorSurfaceView(context: Context) :
  SurfaceView(context),
  SurfaceHolder.Callback {
  init {
    holder.addCallback(this)
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    val canvas = holder.lockCanvas() ?: return
    canvas.drawColor(Color.BLUE)
    holder.unlockCanvasAndPost(canvas)
    contentDescription = PAINTED_LABEL
  }

  override fun surfaceCreated(holder: SurfaceHolder) {}

  override fun surfaceDestroyed(holder: SurfaceHolder) {}

  companion object {
    const val PAINTED_LABEL = "surface-view-painted"
  }
}

// Blue on its left half and yellow on its right, so a capture shows which part
// of the frame it copied and at what scale.
class SplitColorSurfaceView(context: Context) :
  SurfaceView(context),
  SurfaceHolder.Callback {
  init {
    holder.addCallback(this)
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    val canvas = holder.lockCanvas() ?: return
    canvas.drawColor(Color.BLUE)
    canvas.drawRect(width / 2f, 0f, width.toFloat(), height.toFloat(), Paint().apply { color = Color.YELLOW })
    holder.unlockCanvasAndPost(canvas)
    contentDescription = PAINTED_LABEL
  }

  override fun surfaceCreated(holder: SurfaceHolder) {}

  override fun surfaceDestroyed(holder: SurfaceHolder) {}

  companion object {
    const val PAINTED_LABEL = "split-surface-view-painted"
  }
}

class SolidColorTextureViewManager : SimpleViewManager<SolidColorTextureView>() {
  override fun getName() = "SolidColorTextureView"

  override fun createViewInstance(context: ThemedReactContext) = SolidColorTextureView(context)
}

class SolidColorSurfaceViewManager : SimpleViewManager<SolidColorSurfaceView>() {
  override fun getName() = "SolidColorSurfaceView"

  override fun createViewInstance(context: ThemedReactContext) = SolidColorSurfaceView(context)
}

class SplitColorSurfaceViewManager : SimpleViewManager<SplitColorSurfaceView>() {
  override fun getName() = "SplitColorSurfaceView"

  override fun createViewInstance(context: ThemedReactContext) = SplitColorSurfaceView(context)
}

class PaintedSurfacesPackage : ReactPackage {
  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> =
    listOf(SolidColorTextureViewManager(), SolidColorSurfaceViewManager(), SplitColorSurfaceViewManager())
}
