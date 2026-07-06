/**
 * nenova.exe ClassCustomerProdCost.Select — FormCustomerProdCost
 */
export function sqlCustomerProdCostSelect() {
  return `
SELECT p.CounName,
       p.FlowerName,
       p.ProdName,
       p.ProdKey,
       cp.Cost,
       cp.Descr
  FROM Product p
  LEFT JOIN CustomerProdCost cp
    ON cp.ProdKey = p.ProdKey AND cp.CustKey = @custKey
 WHERE p.CountryFlower = @countryFlower
 ORDER BY p.CounName, p.FlowerName, p.ProdName`;
}
