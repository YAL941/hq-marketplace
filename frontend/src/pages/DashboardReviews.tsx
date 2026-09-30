import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reviewApi } from '../../services/api';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Card } from '../components/common/Card';
import { RatingStars } from '../components/common/RatingStars';
import { cn, formatRelativeTime } from '../../lib/utils';
import { Star, MessageSquare, CheckCircle, X, AlertCircle, Edit } from 'lucide-react';

const statusColors: Record<string, string> = {
  pending: 'warning',
  published: 'success',
  rejected: 'error',
  hidden: 'default',
};

export function DashboardReviewsPage() {
  const { currentBusiness } = useAuth();
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [respondingTo, setRespondingTo] = useState<number | null>(null);
  const [responseText, setResponseText] = useState('');

  useEffect(() => {
    if (!currentBusiness) return;
    const fetchReviews = async () => {
      setLoading(true);
      try {
        const response = await reviewApi.listForBusiness(currentBusiness.business_id, {
          status: statusFilter || undefined,
          limit: 50,
        });
        setReviews(response.data.data);
      } catch (error) {
        console.error('Failed to fetch reviews:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchReviews();
  }, [currentBusiness, statusFilter]);

  const handleRespond = async (reviewId: number) => {
    if (!responseText.trim()) return;
    try {
      await reviewApi.respond(currentBusiness!.business_id, reviewId, responseText);
      setReviews(reviews.map(r => r.review_id === reviewId ? { ...r, business_response: responseText, responded_at: new Date().toISOString(), status: 'published' } : r));
      setRespondingTo(null);
      setResponseText('');
    } catch (error) {
      alert('Failed to respond to review');
    }
  };

  const handleModerate = async (reviewId: number, status: 'published' | 'hidden') => {
    try {
      await reviewApi.moderate(currentBusiness!.business_id, reviewId, status);
      setReviews(reviews.map(r => r.review_id === reviewId ? { ...r, status } : r));
    } catch (error) {
      alert('Failed to moderate review');
    }
  };

  if (!currentBusiness) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-16">
          <h1 className="text-2xl font-bold text-navy-900 mb-2">No Business Selected</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Reviews</h1>
          <p className="text-navy-500">Manage and respond to customer reviews</p>
        </div>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-4 mb-4 p-4 border-b border-navy-200">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-full sm:w-48"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="published">Published</option>
            <option value="hidden">Hidden</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {loading ? (
          <div className="space-y-3 p-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i} padding="md" className="animate-pulse">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-navy-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-navy-200 rounded w-1/4" />
                    <div className="h-3 bg-navy-200 rounded w-3/4" />
                    <div className="h-3 bg-navy-200 rounded w-1/2" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : reviews.length > 0 ? (
          <div className="space-y-4 p-4">
            {reviews.map((review) => (
              <Card key={review.review_id} padding="md" className="relative">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary-600 font-medium">
                      {review.user_full_name?.charAt(0) || 'U'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h4 className="font-medium text-navy-900 truncate">
                        {review.user_full_name || 'Anonymous'}
                      </h4>
                      <RatingStars rating={review.rating} size="sm" />
                    </div>
                    <div className="flex items-center gap-3 text-sm text-navy-500 mb-2">
                      <span>{formatRelativeTime(review.created_at)}</span>
                      <Badge
                        variant={statusColors[review.status] || 'default'}
                        size="sm"
                      >
                        {review.status}
                      </Badge>
                    </div>
                    {review.review_text && (
                      <p className="text-navy-700 mb-3">{review.review_text}</p>
                    )}
                    {review.business_response && (
                      <div className="mb-3 p-3 bg-primary-50 rounded-lg border border-primary-100">
                        <div className="flex items-center gap-1.5 text-sm text-primary-700 mb-1">
                          <MessageSquare className="w-4 h-4" />
                          <span className="font-medium">Your Response:</span>
                        </div>
                        <p className="text-primary-800">{review.business_response}</p>
                        <p className="text-xs text-primary-500 mt-1">
                          Responded {formatRelativeTime(review.responded_at!)}
                        </p>
                      </div>
                    )}
                    {review.status === 'pending' && !review.business_response && (
                      <div className="mt-3 pt-3 border-t border-navy-100">
                        {respondingTo === review.review_id ? (
                          <div className="space-y-2">
                            <textarea
                              value={responseText}
                              onChange={(e) => setResponseText(e.target.value)}
                              placeholder="Write your response..."
                              rows={3}
                              className="w-full px-3 py-2 border border-navy-300 rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setRespondingTo(null)}>
                                Cancel
                              </Button>
                              <Button size="sm" onClick={() => handleRespond(review.review_id)}>
                                Post Response
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setRespondingTo(review.review_id)}
                            className="px-3 py-1.5 bg-primary-500 text-white text-sm rounded-button hover:bg-primary-600 transition-colors"
                          >
                            <MessageSquare className="w-4 h-4 inline mr-1.5" />
                            Respond
                          </button>
                        )}
                      </div>
                    )}

                    {review.status === 'published' && review.business_response && (
                      <div className="mt-3 pt-3 border-t border-navy-100 flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleModerate(review.review_id, 'hidden')}>
                          <X className="w-4 h-4 inline mr-1.5 text-warning-600" />
                          Hide
                        </Button>
                      </div>
                    )}

                    {review.status === 'hidden' && (
                      <div className="mt-3 pt-3 border-t border-navy-100 flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleModerate(review.review_id, 'published')}>
                          <CheckCircle className="w-4 h-4 inline mr-1.5 text-success-600" />
                          Publish
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Star className="w-16 h-16 text-navy-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-navy-900 mb-2">No reviews yet</h3>
            <p className="text-navy-500">Customer reviews will appear here</p>
          </div>
        )}
      </Card>
    </div>
  );
}