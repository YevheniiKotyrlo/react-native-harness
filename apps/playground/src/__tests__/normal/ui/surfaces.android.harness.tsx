import { describe, test, render, expect } from 'react-native-harness';
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
          style={{ width: 96, height: 96 }}
        />
        <SolidColorSurfaceView
          testID="surface-view"
          style={{ width: 96, height: 96 }}
        />
      </View>
    );
    await screen.findByAccessibilityLabel('texture-view-painted');
    await screen.findByAccessibilityLabel('surface-view-painted');

    const textureView = await screen.findByTestId('texture-view');
    await expect(await screen.screenshot(textureView)).toMatchImageSnapshot({
      name: 'texture-view-red',
    });

    const surfaceView = await screen.findByTestId('surface-view');
    await expect(await screen.screenshot(surfaceView)).toMatchImageSnapshot({
      name: 'surface-view-blue',
    });
  });

  test('places a SurfaceView at its offset, under the views drawn over it', async () => {
    await render(
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          testID="surfaces"
          style={{ flexDirection: 'row', padding: 8, backgroundColor: 'white' }}
        >
          <SolidColorTextureView style={{ width: 96, height: 96 }} />
          <SolidColorSurfaceView
            style={{ width: 96, height: 96, marginLeft: 8 }}
          />
          <View
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 48,
              height: 48,
              backgroundColor: 'green',
            }}
          />
        </View>
      </View>
    );
    await screen.findByAccessibilityLabel('texture-view-painted');
    await screen.findByAccessibilityLabel('surface-view-painted');

    const surfaces = await screen.findByTestId('surfaces');
    await expect(await screen.screenshot(surfaces)).toMatchImageSnapshot({
      name: 'surfaces-overlapped',
    });
  });
});
