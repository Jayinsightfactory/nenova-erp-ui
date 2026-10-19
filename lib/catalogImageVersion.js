export function versionCatalogImage(image) {
  if (!image?.url || !image.updatedAt) return image;
  const url = image.url.replace(/([?&])catalogVersion=[^&#]*(&?)/, (_, separator, tail) => tail ? separator : '').replace(/[?&]$/, '');
  return { ...image, url: `${url}${url.includes('?') ? '&' : '?'}catalogVersion=${encodeURIComponent(image.updatedAt)}` };
}

export function versionCatalogImageResponse(data) {
  return { ...data,
    images: (data.images || []).map(versionCatalogImage),
    byProdKey: Object.fromEntries(Object.entries(data.byProdKey || {}).map(([key, images]) => [key, images.map(versionCatalogImage)])),
  };
}
