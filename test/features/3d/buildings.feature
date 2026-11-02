@3d-layer
Feature: Building volumes from PMTiles
  Scenario: Cancelled building downloads release their slots and reload on return
    Given a map with the standalone 3D module and no dependency import map
    Then cancelled building downloads recover without errors or stale meshes

  Scenario: The Paris example prevents navigation outside its local archives
    Given the Eiffel Tower example page is open
    Then the Paris example keeps navigation inside the building archive

  Scenario: Building blocks cover the visible ground through camera changes
    Given a map with the standalone 3D module and no dependency import map
    Then building blocks cover pitched views and retain overlapping areas

  Scenario Outline: Invalid source blocks report errors without partial meshes
    Given a map with the standalone 3D module and no dependency import map
    Then a source block with "<invalid>" reports "<message>" without attaching a mesh

    Examples:
      | invalid            | message                     |
      | collection         | Invalid GeoJSON response    |
      | geometry           | Unsupported GeoJSON geometry |
      | coordinates        | Invalid GeoJSON coordinates |
      | empty polygon      | Empty GeoJSON polygon       |
      | short ring         | Invalid GeoJSON polygon ring |

  @paris-buildings
  Scenario: Building volumes render with holes, storey heights, and interaction
    Given the Paris buildings example is open with sample volumes
    Then the building volumes preserve courtyards and elevated floors
    When I move and toggle the Paris building volumes
    Then 3D coverage follows the viewport, releases distant volumes, and recovers from failures

  @eiffel @3d-example
  Scenario Outline: The example filters invalid building volumes and estimates valid heights
    Given the Eiffel Tower example page is open
    Then building style for <storeys> storeys, <floors> floors and ground <ground> is "<result>"

    Examples:
      | storeys | floors | ground | result |
      | 4       | 5      | 1      | 15/0   |
      | 4       | 2      | 0      | 15/9   |
      | 0       | 1      | 1      | 3/0    |
      | -1      | 1      | 1      | skip   |
      | 4       | 0      | 0      | skip   |
      | 4       | 6      | 0      | skip   |
      | 4       | 2      | 2      | skip   |
