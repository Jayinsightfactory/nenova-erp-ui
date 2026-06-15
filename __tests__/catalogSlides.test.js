// node __tests__/catalogSlides.test.js
const assert = (label, cond) => {
  if (!cond) {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS ${label}`);
  }
};

async function main() {
  const {
    addGroupToComposer,
    assignComposerSlot,
    perPageSlotCount,
    resizeComposerSlides,
    resolveCatalogPages,
    sortProductsImageFirst,
  } = await import('../lib/catalogSlides.js');

  const imagesByProd = {
    1: [{ id: 'a', url: '/img/1.jpg' }],
  };

  const products = [
    { ProdKey: 1, ProdName: 'A', CountryFlower: '콜롬비아카네이션', FlowerName: '카네이션', CounName: '콜롬비아' },
    { ProdKey: 2, ProdName: 'B', CountryFlower: '콜롬비아카네이션', FlowerName: '카네이션', CounName: '콜롬비아' },
  ];

  const sorted = sortProductsImageFirst(products, imagesByProd);
  assert('image-first sort', sorted[0].ProdKey === 1 && sorted[1].ProdKey === 2);
  assert('perPage 8', perPageSlotCount(8) === 8);
  assert('perPage 10', perPageSlotCount(10) === 10);

  const lines = [
    { id: 'l2', prodKey: 2, countryFlower: '콜롬비아카네이션', flowerName: '카네이션', counName: '콜롬비아' },
    { id: 'l1', prodKey: 1, countryFlower: '콜롬비아카네이션', flowerName: '카네이션', counName: '콜롬비아', imageUrl: '/x.jpg' },
  ];
  const slides = addGroupToComposer([], {
    groupKey: '콜롬비아카네이션',
    lines,
    perPage: 8,
    imagesByProd,
  });
  assert('group add one slide', slides.length === 1);
  assert('image-first slot order', slides[0].slots[0] === 'l1' && slides[0].slots[1] === 'l2');

  const moved = assignComposerSlot([{
    id: 's1',
    titleBig: '카네이션',
    titleSmall: '콜롬비아',
    slots: ['l1', null, 'l2', null, null, null, null, null],
  }], 's1', 1, 'l2');
  assert('slot move', moved[0].slots[1] === 'l2' && moved[0].slots[2] === null);

  const linesById = {
    l1: { id: 'l1', flowerName: '카네이션', counName: '콜롬비아' },
    l2: { id: 'l2', flowerName: '카네이션', counName: '콜롬비아' },
  };
  const resized = resizeComposerSlides([{
    id: 's1',
    titleBig: '카네이션',
    titleSmall: '콜롬비아',
    slots: ['l1', 'l2', null, null, null, null, null, null],
  }], 10, linesById);
  assert('resize to 10 slots', resized[0].slots.length === 10);
  assert('resize keeps order', resized[0].slots[0] === 'l1' && resized[0].slots[1] === 'l2');

  const pages = resolveCatalogPages({
    lines: [
      { id: 'l1', countryFlower: 'A', flowerName: 'F', counName: 'C', prodName: 'P1' },
      { id: 'l2', countryFlower: 'A', flowerName: 'F', counName: 'C', prodName: 'P2' },
    ],
    composerSlides: [{
      id: 's1',
      titleBig: 'F',
      titleSmall: 'C',
      slots: ['l2', 'l1', null, null, null, null, null, null],
    }],
    perPage: 8,
  });
  assert('composer pages order', pages[0].lines.map(l => l.id).join(',') === 'l2,l1');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
