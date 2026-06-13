import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import news_sorter


GRADE_RESPONSE = """
var gradestr = '<div class="bt">
<span id="sgrade2"><div>7</div></span>
<span id="sgrade0"><div>1</div></span>
</div>';
"""


class GradeParsingTests(unittest.TestCase):
    def test_extracts_full_news_id(self):
        self.assertEqual(
            news_sorter.extract_news_id(
                "https://www.ithome.com/0/963/924.htm"
            ),
            "963924",
        )

    def test_parses_grade_counts(self):
        self.assertEqual(
            news_sorter.parse_grade_response(GRADE_RESPONSE),
            (7, 1),
        )

    def test_rejects_invalid_response(self):
        with self.assertRaises(ValueError):
            news_sorter.parse_grade_response("var gradestr = '';")


class FetchNewsValuesTests(unittest.TestCase):
    @patch("news_sorter.requests.get")
    def test_fetches_score_from_grade_endpoint(self, get):
        response = Mock(status_code=200, text=GRADE_RESPONSE)
        response.raise_for_status.return_value = None
        get.return_value = response

        score = news_sorter.fetch_news_value(
            "普通科技新闻",
            "https://www.ithome.com/0/963/924.htm",
        )

        self.assertEqual(score, 8.75)
        self.assertIn("/grade/963924", get.call_args.args[0])

    @patch("news_sorter.time.sleep")
    @patch("news_sorter.requests.get")
    def test_request_failure_retries_and_returns_low_score(self, get, sleep):
        get.side_effect = news_sorter.requests.RequestException("failed")

        score = news_sorter.fetch_news_value(
            "普通科技新闻",
            "https://www.ithome.com/0/963/924.htm",
        )

        self.assertEqual(score, news_sorter.FAILED_SCORE)
        self.assertEqual(get.call_count, news_sorter.MAX_RETRIES)

    def test_filtered_news_skips_network_scoring(self):
        values = news_sorter.fetch_news_values(
            [("限时好价 99 元", "https://example.com/deal")]
        )

        self.assertEqual(
            values["https://example.com/deal"],
            str(news_sorter.FILTERED_SCORE),
        )


if __name__ == "__main__":
    unittest.main()
