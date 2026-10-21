import { describe, test, render, expect } from 'react-native-harness';
import { PixelRatio, View } from 'react-native';
import { screen } from '@react-native-harness/ui';

const pngSize = (data: Uint8Array) => {
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: header.getUint32(16), height: header.getUint32(20) };
};

const describeCapture = (screenshot: { data: Uint8Array } | null): string => {
  if (screenshot === null) {
    return 'null';
  }
  const { width, height } = pngSize(screenshot.data);
  return `${width}x${height}`;
};

describe('capture geometry', () => {
  test('an element of zero size is not captured as the whole window', async () => {
    await render(
      <View style={{ flex: 1 }}>
        <View testID="empty" style={{ width: 0, height: 0 }} />
      </View>
    );

    const screenshot = await screen.screenshot(await screen.findByTestId('empty'));

    expect(describeCapture(screenshot)).toBe('null');
  });

  test('a region is captured at the size its box covers on the screen', async () => {
    await render(
      <View style={{ flex: 1 }}>
        <View
          testID="box"
          style={{
            position: 'absolute',
            left: 10,
            top: 10,
            width: 33,
            height: 33,
            backgroundColor: 'red',
          }}
        />
      </View>
    );

    const element = await screen.screenshot(await screen.findByTestId('box'));
    const region = await screen.screenshot({ x: 10, y: 10, width: 33, height: 33 });

    expect(`region ${describeCapture(region)} at density ${PixelRatio.get()}`).toBe(
      `region ${describeCapture(element)} at density ${PixelRatio.get()}`
    );
  });
});
