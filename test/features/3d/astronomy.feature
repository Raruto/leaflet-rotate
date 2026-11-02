@unit
Feature: Sun, moon and sky colours for the simulation clock

  Scenario Outline: The sun follows seasons and the time of day in Paris
    When the sun is computed for "<time>" at the Eiffel Tower
    Then its altitude is between <low> and <high> degrees

    Examples:
      | time                 | low | high |
      | 2026-06-21T12:00:00Z | 64  | 65   |
      | 2026-12-21T12:00:00Z | 17  | 18   |
      | 2026-06-21T00:00:00Z | -90 | 0    |

  Scenario: The sun crosses the sky from east to west
    When the sun is computed for "2026-06-21T12:00:00Z" at the Eiffel Tower
    Then its azimuth is between 175 and 190 degrees
    And its direction is a unit vector
    And the same instant written as "2026-06-21T14:00:00+02:00" gives the same sun
    And its direction points east at "2026-06-21T06:00:00Z" and west at "2026-06-21T18:00:00Z"

  Scenario: The full moon is opposite the sun and moves with time and place
    When the moon is computed for "2026-03-03T11:38:00Z" at the Eiffel Tower
    Then its direction is a unit vector
    And it is opposite the sun
    And it changes one hour later and in the southern hemisphere

  Scenario: The atmosphere blends daylight, warm twilight and cool nights continuously
    Then daylight has a neutral tint
    And the tint stays constant below -18 and above 25 degrees
    And night is blue while sunset is red
    And the tint is continuous around -18, -6, 0, 10 and 25 degrees

  Scenario Outline: Invalid sky inputs are rejected
    Then computing <body> with <input> fails with "<error>"

    Examples:
      | body           | input          | error                 |
      | the sun        | an empty date  | Invalid solar         |
      | the sun        | latitude 91    | Invalid solar         |
      | the moon       | "invalid" date | Invalid solar         |
      | the atmosphere | NaN altitude   | Invalid solar altitude |
