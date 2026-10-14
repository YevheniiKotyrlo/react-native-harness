import { describe, test, render, expect, waitFor } from 'react-native-harness';
import { View } from 'react-native';
import { screen } from '@react-native-harness/ui';

import {
  SolidColorSurfaceView,
  SolidColorTextureView,
} from '../../../native/SolidColorSurfaces';

describe('Screenshot of views drawn on a surface of their own', () => {
  test('shows what a TextureView and a SurfaceView display', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <SolidColorTextureView
          testID="texture-view"
          style={{ width: 100, height: 100 }}
        />
        <SolidColorSurfaceView
          testID="surface-view"
          style={{ width: 100, height: 100 }}
        />
      </View>
    );
    await waitFor(() => screen.findByAccessibilityLabel('texture-view-painted'));
    await waitFor(() => screen.findByAccessibilityLabel('surface-view-painted'));

    const textureView = await screen.findByTestId('texture-view');
    await expect(await screen.screenshot(textureView)).toMatchImageSnapshot({
      name: 'texture-view-red',
    });

    const surfaceView = await screen.findByTestId('surface-view');
    await expect(await screen.screenshot(surfaceView)).toMatchImageSnapshot({
      name: 'surface-view-blue',
    });
  });
});
