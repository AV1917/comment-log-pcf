import * as React from 'react';
import { Avatar, Card, Text, Checkbox, type CheckboxOnChangeData } from '@fluentui/react-components';
import type { CommentViewModel, RecordReference } from '../types/commentLogTypes';
import { errorMessage } from '../utils/values';
import { measureCollapsedBody } from '../utils/bodyOverflow';

export interface ICommentCardProps {
  comment: CommentViewModel;
  disabled: boolean;
  isSelected: boolean;
  onToggleSelected: (id: string, selected: boolean) => void;
  onOpen: () => void;
  onOpenAuthor: (author: RecordReference) => void;
  loadAuthorPhoto: (author: RecordReference) => Promise<string | undefined>;
}

const getReadableTextColor = (hex: string): 'black' | 'white' => {
  const channels = [1, 3, 5].map(start => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 < 0.45 ? 'white' : 'black';
};

const OpenIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M9 2h5v5h-1V3.7L7.85 8.85l-.7-.7L12.3 3H9V2zM3 4h5v1H4v8h8V8h1v6H3V4z" fill="currentColor" />
  </svg>
);

export const CommentCard: React.FC<ICommentCardProps> = ({
  comment, disabled, isSelected, onToggleSelected, onOpen, onOpenAuthor, loadAuthorPhoto,
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const [canToggle, setCanToggle] = React.useState(false);
  const [photo, setPhoto] = React.useState<{ key: string; url?: string }>();
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const author = comment.author;
  const authorKey = author ? `${author.entityName}|${author.id}` : '';
  const authorId = author?.id;
  const authorEntity = author?.entityName;

  React.useEffect(() => {
    if (!authorId || !authorEntity) return;
    let cancelled = false;
    const key = `${authorEntity}|${authorId}`;
    void loadAuthorPhoto({ id: authorId, entityName: authorEntity }).then(url => {
      if (!cancelled) setPhoto({ key, url });
      return undefined;
    }).catch((error: unknown) => {
      if (!cancelled) {
        setPhoto({ key });
        console.warn(`Could not load the author photo: ${errorMessage(error)}`);
      }
    });
    return () => { cancelled = true; };
  }, [authorId, authorEntity, loadAuthorPhoto]);

  React.useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCanToggle(measureCollapsedBody(node)));
    };
    schedule();
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver === 'function') {
      let width = node.getBoundingClientRect().width;
      observer = new ResizeObserver(entries => {
        const nextWidth = entries[0]?.contentRect.width;
        if (nextWidth !== undefined && nextWidth !== width) {
          width = nextWidth;
          schedule();
        }
      });
      observer.observe(node);
    } else {
      window.addEventListener('resize', schedule);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [comment.body, expanded]);

  const onSelectedChange = (event: React.ChangeEvent<HTMLInputElement>, data: CheckboxOnChangeData) => {
    event.stopPropagation();
    if (!disabled) onToggleSelected(comment.id, data.checked === true);
  };
  const photoUrl = photo?.key === authorKey ? photo.url : undefined;
  const pillStyle: React.CSSProperties = comment.typeColor
    ? { backgroundColor: comment.typeColor, color: getReadableTextColor(comment.typeColor) }
    : { backgroundColor: '#f3f2f1', color: '#201f1e' };

  return (
    <Card className="comment-card" appearance="filled" role="listitem">
      <div className="comment-lines">
        <div className="comment-line">
          <Checkbox className="card-select-checkbox" checked={isSelected} onChange={onSelectedChange} aria-label="Select comment" disabled={disabled} />
          {comment.usesTypePlaceholder ? (
            <span>{comment.typeLabel} by</span>
          ) : (
            <>
              <span className="type-pill" style={pillStyle} title={comment.typeLabel}>
                <span className="type-pill-text">{comment.typeLabel}</span>
              </span>
              <span>by</span>
            </>
          )}
          <span className="uploader">
            {author ? (
              <button type="button" className="dv-lookup" onClick={event => {
                event.stopPropagation();
                onOpenAuthor(author);
              }} disabled={disabled}>
                <Avatar name={comment.authorName} size={24} color="colorful" image={photoUrl ? { src: photoUrl } : undefined} aria-hidden="true" />
                <span className="dv-lookup-name" title={comment.authorName}>{comment.authorName}</span>
              </button>
            ) : (
              <span className="uploader-name" title={comment.authorName}>{comment.authorName}</span>
            )}
          </span>
          <span className="upload-date">@ {comment.dateText}</span>
          <span className="spacer" />
          <button type="button" className="link-button open-button" aria-label="Open" onClick={onOpen} disabled={disabled}>
            <OpenIcon />
          </button>
        </div>
        {comment.title ? (
          <div className="comment-line"><Text className="comment-title" weight="semibold">{comment.title}</Text></div>
        ) : null}
        <div className="comment-line comment-body-wrap" style={!comment.title ? { marginTop: 3 } : undefined}>
          <div ref={bodyRef} className={`comment-body${expanded ? '' : ' is-collapsed'}`}>{comment.body}</div>
        </div>
        {canToggle ? (
          <div className="comment-line">
            <button type="button" className="link-button toggle-button" onClick={() => setExpanded(value => !value)}
              aria-expanded={expanded} aria-label={expanded ? 'Show less' : 'Show more'} disabled={disabled}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
};