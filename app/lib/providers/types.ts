export interface BBox {
  lowerLeftLat: number;
  lowerLeftLong: number;
  upperRightLat: number;
  upperRightLong: number;
}

export interface CityConfig {
  id: string;
  name: string;
  defaultCenter: [number, number];
  defaultZoom: number;
  defaultBounds: BBox;
  /** Base URL path for static shape/stop files, e.g. '/shapes/goteborg' */
  shapesPath: string;
}
