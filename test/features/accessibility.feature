Feature: Accessible Canvas markers
  Scenario: Canvas markers preserve Leaflet keyboard accessibility
    Given the example page is open
    When I focus and activate a Canvas marker with the keyboard
    Then its accessible button supports names, focus, popups and cleanup
