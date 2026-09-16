import { Platform } from 'react-native';

export const FONT_UI = Platform.select({ ios: 'Archivo Black', android: 'ArchivoBlack-Regular', default: 'Archivo Black' })!;
export const FONT_DISPLAY = Platform.select({ ios: 'Uncial Antiqua', android: 'UncialAntiqua-Regular', default: 'Uncial Antiqua' })!;
