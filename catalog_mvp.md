# MVP Product Requirements Document

## Interior Design -- Product Catalog

**Document type:** Product Requirements Document (PRD)\
**Version:** 1.0 -- MVP\
**Status:** Draft for team review\
**Feature:** Product Catalog\
**Parent application:** Existing interior design application\
**Language:** English

------------------------------------------------------------------------

## 1. Product Overview

The Product Catalog is a feature within an existing interior design
application. It allows a designer and a client to browse interior-design
products, save favorites, and build a shopping list of selected products
with estimated costs.

This is **not an e-commerce storefront**. The MVP does not support
checkout, payment, ordering, or purchasing products. The shopping list
is a planning and collaboration tool used to collect product selections
and estimate the project budget.

The existing application already provides authentication and the overall
application shell. This project is limited to the Product Catalog
feature and must integrate with the existing application.

### 1.1 MVP Approach

-   Use local mock data; no backend or API is required for the MVP.
-   Reuse the existing application's design system, components,
    navigation conventions, and visual language.
-   Build the feature so that the mock data layer can later be replaced
    by an API without rewriting the UI.
-   Keep the implementation focused on the catalog, favorites, shopping
    list, export, and approval flow.

------------------------------------------------------------------------

## 2. Goals

1.  Provide a visual, easy-to-use catalog of interior-design products.
2.  Allow both designers and clients to browse and select products.
3.  Support product options for color and size.
4.  Allow users to save products to a Favorites list independently of
    the Shopping List.
5.  Provide a Shopping List with editable quantities and dynamically
    calculated estimated costs.
6.  Allow the client to approve the Shopping List so it can be handed
    over to the designer.
7.  Export the Shopping List to CSV and PDF.
8.  Keep the implementation structured for a future backend/API
    integration.

## 3. Users and Permissions

The parent application already has authentication. Do not implement a
new login or authentication system.

The two user types relevant to this feature are:

  -----------------------------------------------------------------------
  User                                MVP capabilities
  ----------------------------------- -----------------------------------
  Designer                            Browse catalog, filter and sort
                                      products, add/remove favorites, add
                                      products to the Shopping List,
                                      change quantities, remove items,
                                      view totals, export the list, view
                                      approval status

  Client                              Browse catalog, filter and sort
                                      products, add/remove favorites, add
                                      products to the Shopping List,
                                      change quantities, remove items,
                                      view totals, export the list,
                                      approve the Shopping List
  -----------------------------------------------------------------------

Both user types can select products. The client is responsible for
approving the Shopping List.

**MVP limitation:** Since the MVP has no backend, real-time sharing or
synchronization between two separate users/devices is not included. The
approval flow is a frontend simulation using local/mock state. Do not
imply that changes are synchronized between users.

------------------------------------------------------------------------

## 4. Catalog Structure

### 4.1 Main Categories

The catalog contains four main categories:

1.  **Furniture** -- sofas, armchairs, tables, chairs, beds, cabinets,
    etc.
2.  **Lighting** -- ceiling lights, pendant lights, wall lights, floor
    lamps, table lamps, etc.
3.  **Bathroom** -- faucets, sinks, mirrors, bathtubs, shower fixtures,
    etc.
4.  **Decor & Accessories** -- rugs, cushions, vases, artwork,
    decorative objects, etc.

Each category must contain at least five products. The MVP catalog must
contain at least 20 products in total.

The category names and taxonomy should be stored as data/configuration
where practical, rather than hard-coded throughout UI components.

### 4.2 Product Card

Each product card must display:

-   Product image
-   Product name
-   Short description
-   Price
-   Available colors (or a clear indication that color options are
    available)
-   Available sizes (or a clear indication that size options are
    available)
-   Favorite action
-   Add to Shopping List action

Each product must have a unique Product ID/SKU in the data model. The
Product ID does not need to be displayed on the product card.

### 4.3 Product Options: Color and Size

For the MVP, products have two selectable option dimensions:

-   **Color**
-   **Size**

The available options vary by product. A product may have multiple
colors and sizes, one option, or no selectable options where
appropriate.

Examples:

  Product         Available colors           Available sizes
  --------------- -------------------------- ---------------------------
  Sofa            Beige, Brown, Black, Red   2-seater, 3-seater
  Mirror          Aluminum, White, Black     80 × 120 cm, 100 × 150 cm
  Pendant Light   Black, Gold, White         Small, Large

The product image represents the same product in different color
options. In the MVP, selecting a color does not represent a different
material, finish, or product type.

**Material, finish, and other configurable product attributes are out of
scope for the MVP.** They may be considered in a later version.

When a product is added to the Shopping List, the selected color and
size must be stored with that Shopping List item.

### 4.4 Dimensions

Product dimensions are informational product data and may be displayed
in the product details/selection view.

Depending on the product, dimensions may include:

-   Width
-   Height
-   Depth
-   Diameter

For products with multiple sizes, dimensions should be associated with
the relevant size option where applicable.

Dimensions are **not filters** in the MVP.

------------------------------------------------------------------------

## 5. Filtering and Sorting

### 5.1 Primary Catalog Filters

The main catalog view must support:

-   **Category** -- filter by one of the main categories, with an option
    to view all products.
-   **Price Range** -- use a slider to define the minimum and maximum
    price.
-   **Color** -- filter products by available color.

Filters should be usable together. Applying or clearing filters should
update the displayed products.

### 5.2 Sorting

Provide sorting options:

-   Price: Low to High
-   Price: High to Low

Sorting should work with the currently filtered product set.

### 5.3 Category-Specific Filters

Category-specific filters may be added after a main category has been
selected. These are an extension of the primary filtering experience.

Example for Lighting:

-   Lighting Type: Ceiling / Pendant / Wall / Floor / Table

The filter structure should allow category-specific filters to be added
later without redesigning the primary catalog filtering model.

**Category-specific filters are not required for the initial MVP unless
the team has time after completing the Must-have requirements.**

### 5.4 Filtering Out of Scope

The MVP does not include:

-   Filtering by product dimensions or size
-   Rating filters
-   Material or finish filters
-   Advanced style-based filters

Note: Size remains a selectable product option. It is simply not a
catalog filter.

------------------------------------------------------------------------

## 6. Favorites

Users can add products to and remove products from a Favorites list.

Requirements:

-   Provide a Favorite control on each product card.
-   Clearly indicate when a product is already favorited.
-   Provide a separate Favorites view/section where users can see their
    favorited products.
-   Allow users to remove products from Favorites.
-   Favorites must remain separate from the Shopping List.

Adding a product to Favorites must **not** automatically add it to the
Shopping List. A product may be favorited without being intended for
purchase.

For the MVP, Favorites can be stored in local application state or local
persistence, depending on the existing app architecture.

------------------------------------------------------------------------

## 7. Shopping List

The Shopping List is a central part of the feature. It is a
project-planning list, not a checkout cart.

### 7.1 Adding Products

When adding a product to the Shopping List, the user selects the
available options:

-   Color
-   Size
-   Quantity

Default quantity: **1**.

If a product has only one available option for a dimension, the UI may
preselect it. If the product has no options for a dimension, that
selection should not be required.

If the same Product ID with the same selected Color and Size is added
again, update the existing line item's quantity rather than creating a
duplicate line.

If the same Product ID is added with a different Color or Size, create a
separate line item.

### 7.2 Shopping List View

The Shopping List must be displayed as a **list**, not as a product
grid.

Each line item must include:

-   Small product image
-   Product name
-   Selected color
-   Selected size
-   Unit price
-   Quantity control
-   Line total
-   Remove action

The Product ID/SKU does not need to appear in the normal Shopping List
view. It must be included in the CSV export.

### 7.3 Quantity Management

Users can:

-   Increase quantity
-   Decrease quantity
-   Remove an item completely

Quantity must never be less than 1. To remove an item, use the explicit
Remove action.

### 7.4 Price Calculation

Each line item's total is calculated as:

`Line Total = Unit Price × Quantity`

The Shopping List estimated total is:

`Estimated Total = Sum of all Line Totals`

Requirements:

-   Recalculate the line total immediately when quantity changes.
-   Recalculate the overall estimated total immediately when any line
    item is added, removed, or changed.
-   If different sizes have different prices, use the price associated
    with the selected size.
-   Display prices consistently using the currency convention already
    used by the parent application. If the parent application does not
    define a currency, use a configurable currency setting rather than
    scattering a currency symbol throughout the code.

All prices are estimates. No purchase or order is created.

------------------------------------------------------------------------

## 8. Shopping List Approval Workflow

The MVP supports two Shopping List states:

1.  **Draft** -- the list is being built and edited.
2.  **Approved** -- the client has approved the list, and it is ready
    for the designer to handle.

### Draft

-   Both Designer and Client can add products.
-   Both can change quantities and remove items.
-   The list displays its current estimated total.
-   The Client can approve the list.

### Approved

-   The list displays an Approved status.
-   The Designer can see that the list has been approved and is ready
    for follow-up.
-   No notification system is required.

For the MVP, approval is a frontend state transition. It is not a
server-side workflow and does not trigger an external process.

The team should avoid implementing additional workflow states, such as
submission, procurement, or order placement, unless required by the
parent application.

**Open implementation consideration:** The behavior of editing an
already approved list is not defined as a complex workflow in this MVP.
At minimum, any subsequent edit should not silently leave the UI showing
an approval that no longer reflects the current list. The team may
either return the list to Draft on edit or prevent editing after
approval; confirm the expected behavior with the parent application/team
before implementation.

------------------------------------------------------------------------

## 9. Export

Users can export the Shopping List in CSV and PDF formats.

### 9.1 CSV Export

The CSV must include one row per Shopping List line item and the
following columns:

  Column         Description
  -------------- -----------------------------------
  Product ID     Unique product identifier/SKU
  Product Name   Product name
  Category       Product category
  Color          Selected color
  Size           Selected size
  Quantity       Selected quantity
  Unit Price     Price per unit
  Line Total     Unit price multiplied by quantity

Include the estimated overall total in a clearly labeled summary row or
a separate summary section, while keeping the CSV easy to parse.

Example:

``` csv
Product ID,Product Name,Category,Color,Size,Quantity,Unit Price,Line Total
FUR-001,Modern Sofa,Furniture,Beige,3-seater,1,4500,4500
BTH-004,Wall Mirror,Bathroom,Black,100x150 cm,2,600,1200
```

### 9.2 PDF Export

The PDF should be a clean, readable Shopping List document suitable for
sharing and printing.

Include:

-   Project name, if available from the parent application
-   Export date
-   Product image (where practical)
-   Product name
-   Product ID/SKU
-   Category
-   Selected color
-   Selected size
-   Quantity
-   Unit price
-   Line total
-   Estimated overall total
-   Approval status

The PDF should follow the parent application's visual style where
practical and have a print-friendly layout.

------------------------------------------------------------------------

## 10. Mock Data and Data Model

### 10.1 Data Source

The MVP uses local mock data. No API, backend, or database is required.

Keep data access separate from UI components. Components should consume
product and Shopping List data through a clear data/state layer rather
than embedding mock product objects directly inside presentation
components.

This separation is important because a future version may replace the
mock data source with API calls.

### 10.2 Product Data Example

The following is an illustrative structure. Adapt naming and typing
conventions to the existing codebase.

``` json
{
  "id": "FUR-001",
  "name": "Modern Sofa",
  "category": "Furniture",
  "description": "Contemporary three-seat sofa",
  "image": "/images/modern-sofa.jpg",
  "basePrice": 4500,
  "colors": [
    "Beige",
    "Brown",
    "Black",
    "Red"
  ],
  "sizes": [
    {
      "id": "2-seater",
      "name": "2 Seater",
      "price": 4000,
      "dimensions": {
        "width": 180,
        "height": 85,
        "depth": 90
      }
    },
    {
      "id": "3-seater",
      "name": "3 Seater",
      "price": 4500,
      "dimensions": {
        "width": 220,
        "height": 85,
        "depth": 95
      }
    }
  ]
}
```

If all sizes have the same price, a single product-level price may be
used. If prices vary by size, store the price on the size option. Avoid
maintaining conflicting price values.

### 10.3 Shopping List Item Example

``` json
{
  "productId": "FUR-001",
  "selectedColor": "Beige",
  "selectedSizeId": "3-seater",
  "quantity": 2,
  "unitPrice": 4500
}
```

The product name, image, category, and other display data can be
resolved from the product catalog using `productId`. The line total and
overall total should be calculated from the current item data rather
than manually maintained as independent values.

### 10.4 Favorites Data

Favorites can be represented as a collection of Product IDs.

### 10.5 Minimum Mock Data Requirements

-   Four main categories.
-   At least five products per category.
-   At least 20 products overall.
-   Every product has a unique Product ID.
-   Every product has an image, name, description, category, and price.
-   Products should have realistic and varied color and size options
    where relevant.
-   Some products may have only one size or color option.

Use suitable image assets for the mock catalog. Do not rely on broken or
inaccessible image URLs.

------------------------------------------------------------------------

## 11. UI/UX and Application Integration

### 11.1 Design System Integration

The catalog is part of an existing application. It must look and behave
like a native part of that application.

Requirements:

-   Inspect the existing application before implementation.
-   Reuse existing design tokens, typography, colors, spacing, buttons,
    icons, cards, form controls, and navigation patterns.
-   Reuse existing shared components wherever appropriate.
-   Follow the existing application's English-language UI conventions.
-   Do not introduce a separate visual identity or a new design system.
-   Do not modify unrelated application areas.

The existing application is the source of truth for visual design.

### 11.2 Main Views

The feature should provide the following views or sections, following
the existing application's navigation conventions:

1.  **Catalog** -- product grid, categories, filters, and sorting.
2.  **Product Selection/Details** -- product information and selection
    of color, size, and quantity before adding to the Shopping List.
3.  **Favorites** -- products saved by the user.
4.  **Shopping List** -- selected products in list format, quantity
    controls, totals, export, and approval status.

A separate full page is not mandatory for every view. Use the navigation
and layout patterns already present in the parent application.

### 11.3 Responsive Behavior

The feature must work on desktop and smaller screens, following the
responsive standards of the existing application.

------------------------------------------------------------------------

## 12. Functional Requirements and Priorities

  ID      Requirement                                         Priority
  ------- --------------------------------------------------- --------------
  FR-01   Display four main product categories                Must
  FR-02   Display at least 20 mock products                   Must
  FR-03   Display product cards with required information     Must
  FR-04   Support product color selection                     Must
  FR-05   Support product size selection                      Must
  FR-06   Display relevant product dimensions                 Must
  FR-07   Filter by category                                  Must
  FR-08   Filter by price range using a slider                Must
  FR-09   Filter by color                                     Must
  FR-10   Sort by price ascending and descending              Must
  FR-11   Add/remove Favorites                                Must
  FR-12   View Favorites separately                           Must
  FR-13   Add products to the Shopping List                   Must
  FR-14   Store selected color and size per line item         Must
  FR-15   Change item quantities                              Must
  FR-16   Remove items from the Shopping List                 Must
  FR-17   Calculate line totals dynamically                   Must
  FR-18   Calculate the overall estimated total dynamically   Must
  FR-19   Export Shopping List to CSV                         Must
  FR-20   Export Shopping List to PDF                         Must
  FR-21   Allow Client to approve the Shopping List           Must
  FR-22   Show approval status to Designer                    Must
  FR-23   Add category-specific filters                       Later
  FR-24   Filter by dimensions                                Out of Scope
  FR-25   Filter by rating                                    Out of Scope
  FR-26   Select material or finish                           Out of Scope
  FR-27   Display Product ID on product cards                 Not Required

------------------------------------------------------------------------

## 13. Out of Scope

The following are explicitly excluded from the MVP:

-   Backend or API implementation
-   Database integration
-   Real-time synchronization between Designer and Client
-   Authentication or login changes
-   Payment, checkout, or actual purchasing
-   Supplier integrations or live product inventory
-   Product ratings and rating filters
-   Dimension-based catalog filtering
-   Material and finish selection
-   Advanced category-specific filters
-   Notifications
-   Complex procurement or order-management workflows
-   Product creation/editing administration tools

------------------------------------------------------------------------

## 14. Acceptance Criteria

The MVP is considered complete when all of the following are true:

### Catalog

-   [ ] The catalog is integrated into the existing application.
-   [ ] The catalog uses the existing application's design system.
-   [ ] Four main categories are available.
-   [ ] At least five products are available in each category.
-   [ ] At least 20 products are displayed with working images.
-   [ ] Every product has a unique Product ID.
-   [ ] Product cards display the required information and actions.

### Product Selection

-   [ ] A user can select an available color.
-   [ ] A user can select an available size.
-   [ ] Relevant dimensions are displayed.
-   [ ] The selected options are retained when adding the product to the
    Shopping List.

### Filtering and Sorting

-   [ ] Category filtering works.
-   [ ] Price range slider filters the displayed products.
-   [ ] Color filtering works.
-   [ ] Both price sorting directions work.
-   [ ] Filters can be combined and cleared.

### Favorites

-   [ ] A user can add and remove a product from Favorites.
-   [ ] Favorited products are clearly marked.
-   [ ] A separate Favorites view displays saved products.
-   [ ] Adding a Favorite does not add it to the Shopping List.

### Shopping List

-   [ ] Products can be added to the Shopping List.
-   [ ] The same product with the same selected options updates the
    existing line quantity.
-   [ ] The same product with different selected options creates a
    separate line.
-   [ ] Quantity can be increased and decreased.
-   [ ] Items can be removed.
-   [ ] Line totals update immediately.
-   [ ] The overall estimated total updates immediately.

### Export and Approval

-   [ ] CSV export contains all required columns, including Product ID.
-   [ ] PDF export contains the required product and cost information.
-   [ ] The Client can approve the Shopping List.
-   [ ] The approved status is visible to the Designer in the MVP
    experience.

### Quality

-   [ ] The feature works on desktop and smaller screens.
-   [ ] No unrelated parts of the parent application are broken or
    unintentionally changed.
-   [ ] No API or backend dependency is required to run the MVP.
-   [ ] The mock data layer is separated from UI components.

------------------------------------------------------------------------

## 15. Implementation Guidance for the Development Team

Before coding:

1.  Inspect the existing repository and understand its framework, folder
    structure, routing, state management, styling, and component
    conventions.
2.  Identify the existing application shell and the correct integration
    point for the Catalog feature.
3.  Inspect the existing design system and reuse it.
4.  Identify any existing shared components or utilities that should be
    reused.
5.  Propose a concise implementation plan and identify assumptions or
    conflicts with the parent application.
6.  Do not introduce new frameworks, libraries, or architectural
    patterns without a clear need.

During implementation:

-   Keep the catalog feature modular and scoped.
-   Separate mock data from UI components.
-   Keep filtering, sorting, Favorites, Shopping List, and price
    calculations in clear, testable logic.
-   Avoid duplicating product data in Shopping List items when it can be
    resolved by Product ID.
-   Handle empty states, no-results states, and products with only one
    available option.
-   Use the existing application's conventions for state persistence. Do
    not add unnecessary infrastructure.
-   Ensure export works with the actual current Shopping List state.

Testing:

-   Test combined filters and clearing filters.
-   Test both sorting directions.
-   Test adding the same product/options more than once.
-   Test adding the same product with different colors or sizes.
-   Test quantity changes, removal, and total calculations.
-   Test Favorites independently from the Shopping List.
-   Test CSV and PDF output.
-   Test approval status behavior.
-   Test responsive layouts.
-   Run relevant existing tests and add focused tests for the new
    feature.

Do not make changes outside the Catalog feature unless they are
necessary for integration and have been identified in the implementation
plan.

------------------------------------------------------------------------

## 16. Open Decisions to Confirm Before or During Implementation

The following details are not fully specified and should be checked
against the parent application or agreed by the team. Do not let these
block initial repository inspection and planning.

1.  **Currency:** Use the currency already established by the parent
    application.
2.  **Project context:** Determine how the current project name and
    project identifier are exposed by the parent application.
3.  **Approved list editing:** Decide whether editing an approved list
    returns it to Draft or whether editing is disabled after approval.
4.  **Local persistence:** Decide whether mock state should survive a
    page refresh, based on the existing app's conventions and the team's
    expectations.
5.  **PDF presentation:** Confirm whether the parent application has an
    existing export/print style or utility.

------------------------------------------------------------------------

**End of MVP PRD**
