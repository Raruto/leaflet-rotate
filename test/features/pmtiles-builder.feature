@unit
Feature: Offline PMTiles archive builder

  Scenario: Tree tiles keep inventory properties and own boundary points exactly once
    Given two trees on either side of a zoom 16 tile boundary
    When the trees are indexed into zoom 16 tiles
    Then each tree is in exactly one tile with its id and properties
    And indexing fails for invalid GeoJSON, invalid coordinates and points outside the archive

  Scenario: Streetlight tiles keep colocated lamps and their photometric records
    Given two streetlights at the same position
    When the streetlights are indexed into zoom 16 tiles
    Then both lamps are kept with their ids and photometric records

  Scenario Outline: Downloads retry missing or empty responses, then fail
    Then a download answered with HTTP <status> fails with "<error>" after 5 attempts

    Examples:
      | status | error               |
      | 404    | HTTP 404            |
      | 503    | HTTP 503            |
      | 200    | Empty tile response |

  Scenario: Downloads succeed after a transient error
    Then a download answered with HTTP 404 once then 200 returns the tile after 2 attempts
    And a download answered with HTTP 400 once then 200 returns the tile after 2 attempts

  Scenario: Archives publish every tile; failures keep the previous archive
    Given a 4-tile archive has been built
    Then its directory lists Hilbert tiles 1 to 4 with their data
    And a build missing a tile is not published and keeps the previous archive
    And a build with failing downloads is not published and keeps the previous archive
