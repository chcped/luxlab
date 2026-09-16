package com.luxlabmobile

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.oney.WebRTCModule.WebRTCModuleOptions
import com.oney.WebRTCModule.MediaProjectionService

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true
    super.onCreate(savedInstanceState)
  }

  override fun onDestroy() {
    MediaProjectionService.abort(this)
    super.onDestroy()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "LuxlabMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
