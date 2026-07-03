import { ConfigContext, ExpoConfig } from 'expo/config';

const appName =
  process.env.EXPO_PUBLIC_APP_NAME ||
  '金基管家';
const projectId = process.env.COZE_PROJECT_ID || process.env.EXPO_PUBLIC_COZE_PROJECT_ID;
const sanitizedProjectId = projectId?.replace(/\W/g, '');
const slugAppName = process.env.EXPO_PUBLIC_APP_SLUG || (projectId ? `app${projectId}` : 'jijin-manage');
const appScheme = process.env.EXPO_PUBLIC_APP_SCHEME || 'jijinmanage';
const androidPackage =
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE ||
  (sanitizedProjectId ? `com.jijinmanage.app${sanitizedProjectId}` : 'com.jijin.manage');

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: appName,
    slug: slugAppName,
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: appScheme,
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#0f766e',
      },
      package: androidPackage,
      versionCode: 1,
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL
        ? [
            'expo-router',
            {
              origin: process.env.EXPO_PUBLIC_BACKEND_BASE_URL,
            },
          ]
        : 'expo-router',
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: `${appName}需要访问您的相册，以便上传或保存图片。`,
          cameraPermission: `${appName}需要使用您的相机，以便拍摄照片上传。`,
          microphonePermission: `${appName}需要访问您的麦克风，以便拍摄带有声音的视频。`,
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission: `${appName}需要访问您的位置，以提供周边服务及导航功能。`,
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission: `${appName}需要访问相机，以拍摄照片和视频。`,
          microphonePermission: `${appName}需要访问麦克风，以录制视频声音。`,
          recordAudioAndroid: true,
        },
      ],
      'expo-sqlite',
    ],
    experiments: {
      typedRoutes: true,
    },
  };
};
