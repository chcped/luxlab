package com.luxlabmobile

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AudioOutputModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "AudioOutput"

  @Suppress("DEPRECATION")
  @ReactMethod
  fun setSpeaker(enabled: Boolean, promise: Promise) {
    try {
      val audio = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      audio.mode = AudioManager.MODE_IN_COMMUNICATION
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val type = if (enabled) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
        val device = audio.availableCommunicationDevices.firstOrNull { it.type == type }
          ?: throw IllegalStateException(if (enabled) "Alto-falante indisponivel." else "Auricular indisponivel.")
        if (!audio.setCommunicationDevice(device)) throw IllegalStateException("Nao foi possivel alterar a saida de audio.")
      } else {
        audio.isSpeakerphoneOn = enabled
      }
      promise.resolve(enabled)
    } catch (error: Exception) {
      promise.reject("AUDIO_OUTPUT", error.message, error)
    }
  }

  @ReactMethod
  fun reset() {
    val audio = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audio.clearCommunicationDevice()
    audio.mode = AudioManager.MODE_NORMAL
  }
}
