import type { CityConfig } from './types';

const goteborg: CityConfig = {
  id: 'goteborg',
  name: 'Göteborg',
  defaultCenter: [57.7089, 11.9746],
  defaultZoom: 13,
  defaultBounds: {
    lowerLeftLat:   57.55,
    lowerLeftLong:  11.75,
    upperRightLat:  57.85,
    upperRightLong: 12.30,
  },
  shapesPath: '/shapes/goteborg',
};

export default goteborg;
