@smoke
Feature: Example smoke tests
  Scenario: The examples list is complete
    Then all HTML examples are listed

  Scenario Outline: An example loads without browser errors
    Then the example "<example>" loads without browser errors

    Examples:
      | example |
      | leaflet-rotate.html |
