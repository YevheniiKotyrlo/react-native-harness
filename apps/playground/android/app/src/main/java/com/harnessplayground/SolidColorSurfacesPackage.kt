package com.harnessplayground

import android.content.Context
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.TextureView
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager

// Views whose pixels live on a surface of their own, as a GPU-rendered view's
// do. Each paints one color from the CPU and labels itself once that frame is
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

class SolidColorTextureViewManager : SimpleViewManager<SolidColorTextureView>() {
  override fun getName() = "SolidColorTextureView"

  override fun createViewInstance(context: ThemedReactContext) = SolidColorTextureView(context)
}

class SolidColorSurfaceViewManager : SimpleViewManager<SolidColorSurfaceView>() {
  override fun getName() = "SolidColorSurfaceView"

  override fun createViewInstance(context: ThemedReactContext) = SolidColorSurfaceView(context)
}

class SolidColorSurfacesPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    emptyList()

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> =
    listOf(SolidColorTextureViewManager(), SolidColorSurfaceViewManager())
}
