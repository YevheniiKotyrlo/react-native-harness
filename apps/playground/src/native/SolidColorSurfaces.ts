import { requireNativeComponent } from 'react-native';
import type { ViewProps } from 'react-native';

// Android only: see SolidColorSurfacesPackage.kt.
export const SolidColorTextureView = requireNativeComponent<ViewProps>(
  'SolidColorTextureView'
);

export const SolidColorSurfaceView = requireNativeComponent<ViewProps>(
  'SolidColorSurfaceView'
);
