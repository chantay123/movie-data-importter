import type { MovieComparison } from '../../types/api.types';
import { MatchStatus } from '../../types/movieImport.types';

/**
 * Props of the {@link DatabaseComparison} component.
 */
export interface DatabaseComparisonProps {
  /** Comparison of the currently selected file. */
  comparison: MovieComparison | null;
  /** Document chosen by the user for an ambiguous match. */
  targetMovieId?: string;
  /** Called when the user picks a document. */
  onSelectTarget: (movieId: string) => void;
}

/**
 * Displays the document found in MongoDB and lets the user pick the right one
 * when several documents could match.
 *
 * @param props - The props of the component.
 * @returns The rendered component.
 */
export function DatabaseComparison(props: DatabaseComparisonProps): JSX.Element {
  const comparison = props.comparison;

  if (!comparison) {
    return (
      <section className="card">
        <h2 className="card__title">D. Đối chiếu với MongoDB</h2>
        <p className="muted">Chưa có dữ liệu để đối chiếu.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="card__title">
        <span>D. Đối chiếu với MongoDB</span>
        <span className="btn-row">
          <span className={`badge badge--${comparison.matchStatus}`}>
            {comparison.matchStatus}
          </span>
          {comparison.matchedBy ? <span className="pill">khớp bởi {comparison.matchedBy}</span> : null}
        </span>
      </h2>

      {comparison.matchStatus === MatchStatus.NEW ? (
        <div className="alert alert--info">
          Phim chưa tồn tại trong database. Xác nhận import sẽ tạo mới một document theo đúng schema
          Movie.
        </div>
      ) : null}

      {comparison.matchStatus === MatchStatus.AMBIGUOUS ? (
        <div className="alert alert--warning">
          Có nhiều bản ghi có khả năng trùng. Hãy chọn đúng bản ghi trước khi import, nếu không hệ
          thống sẽ từ chối import.
        </div>
      ) : null}

      {comparison.candidates.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Chọn</th>
                <th>_id</th>
                <th>Tên</th>
                <th>Slug</th>
                <th>Tên gốc</th>
                <th>Source ID</th>
                <th>TMDB</th>
                <th>Số server</th>
                <th>Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {comparison.candidates.map((candidate) => (
                <tr
                  key={candidate._id}
                  className={candidate._id === props.targetMovieId ? 'is-selected' : undefined}
                >
                  <td>
                    <input
                      type="radio"
                      name="target-movie"
                      checked={candidate._id === props.targetMovieId}
                      onChange={() => props.onSelectTarget(candidate._id)}
                    />
                  </td>
                  <td className="mono">{candidate._id}</td>
                  <td>{candidate.name ?? '-'}</td>
                  <td className="mono">{candidate.slug ?? '-'}</td>
                  <td>{candidate.originName ?? '-'}</td>
                  <td className="mono">{candidate.sourceId ?? '-'}</td>
                  <td className="mono">
                    {candidate.tmdb?.id ? `${candidate.tmdb.id}/${candidate.tmdb.type ?? '-'}` : '-'}
                  </td>
                  <td>{candidate.episodes?.length ?? 0}</td>
                  <td className="muted">
                    {candidate.updatedAt ? new Date(candidate.updatedAt).toLocaleString('vi-VN') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Không tìm thấy bản ghi nào trong database.</p>
      )}
    </section>
  );
}
