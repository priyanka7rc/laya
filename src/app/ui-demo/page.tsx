'use client';

import { useState } from 'react';
import { Button, Card } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import ProtectedRoute from '@/components/ProtectedRoute';

function UIDemoPage() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handlePrimaryClick = () => {
    toast.success('Primary button clicked!', 'This is a success message');
  };

  const handleSecondaryClick = () => {
    toast.info('Secondary button clicked!', 'This is an info message');
  };

  const handleLoadingClick = async () => {
    setLoading(true);
    toast.info('Processing...', 'Please wait');
    
    setTimeout(() => {
      setLoading(false);
      toast.success('Done!', 'Operation completed successfully');
    }, 2000);
  };

  const handleErrorClick = () => {
    toast.error('Error occurred', 'This is an error message');
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black text-white p-4 md:p-8 pb-24 md:pb-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">UI Component Demo</h1>
            <p className="text-gray-400">
              Testing the shared UI kit components
            </p>
          </div>

          {/* Buttons Section */}
          <Card>
            <h2 className="text-xl font-bold mb-4">Buttons</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-400 mb-2">Primary variant:</p>
                <Button onClick={handlePrimaryClick}>
                  Primary Button
                </Button>
              </div>
              
              <div>
                <p className="text-sm text-gray-400 mb-2">Secondary variant:</p>
                <Button variant="secondary" onClick={handleSecondaryClick}>
                  Secondary Button
                </Button>
              </div>
              
              <div>
                <p className="text-sm text-gray-400 mb-2">Loading state:</p>
                <Button loading={loading} onClick={handleLoadingClick}>
                  {loading ? 'Processing...' : 'Click to Load'}
                </Button>
              </div>
              
              <div>
                <p className="text-sm text-gray-400 mb-2">Disabled state:</p>
                <Button disabled>
                  Disabled Button
                </Button>
              </div>

              <div>
                <p className="text-sm text-gray-400 mb-2">Full width:</p>
                <Button className="w-full" onClick={handlePrimaryClick}>
                  Full Width Button
                </Button>
              </div>
            </div>
          </Card>

          {/* Toast Section */}
          <Card>
            <h2 className="text-xl font-bold mb-4">Toast Notifications</h2>
            <div className="space-y-2">
              <Button 
                onClick={() => toast.success('Success!', 'Operation completed')}
                className="w-full"
              >
                Show Success Toast
              </Button>
              
              <Button 
                variant="secondary"
                onClick={handleErrorClick}
                className="w-full"
              >
                Show Error Toast
              </Button>
              
              <Button 
                variant="secondary"
                onClick={() => toast.info('Info', 'This is informational')}
                className="w-full"
              >
                Show Info Toast
              </Button>

              <Button 
                variant="secondary"
                onClick={() => toast({
                  title: 'Custom Duration',
                  description: 'This will stay for 10 seconds',
                  variant: 'info',
                  duration: 10000,
                })}
                className="w-full"
              >
                Show Long Toast (10s)
              </Button>
            </div>
          </Card>

          {/* Card Variations */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Card Variations</h2>
            
            <Card>
              <h3 className="font-semibold text-lg mb-2">Simple Card</h3>
              <p className="text-gray-400">
                This is a basic card with default styling.
              </p>
            </Card>

            <Card className="hover:border-blue-500 cursor-pointer transition-colors">
              <h3 className="font-semibold text-lg mb-2">Interactive Card</h3>
              <p className="text-gray-400">
                This card has hover effects and is clickable.
              </p>
            </Card>

            <Card className="bg-gradient-to-br from-blue-900/20 to-purple-900/20 border-blue-800">
              <h3 className="font-semibold text-lg mb-2">Styled Card</h3>
              <p className="text-gray-400">
                This card has custom gradient background.
              </p>
            </Card>
          </div>

          {/* Complex Example */}
          <Card>
            <h2 className="text-xl font-bold mb-4">Complex Example</h2>
            <p className="text-gray-400 mb-4">
              Combining multiple components together
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Sample Input
                </label>
                <input
                  type="text"
                  placeholder="Type something..."
                  className="w-full h-11 px-4 bg-gray-800 border border-gray-700 rounded-2xl text-white placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                />
              </div>
              
              <div className="flex gap-2">
                <Button 
                  className="flex-1"
                  onClick={() => toast.success('Submitted!', 'Form submitted successfully')}
                >
                  Submit
                </Button>
                <Button 
                  variant="secondary"
                  onClick={() => toast.info('Cancelled', 'No changes were made')}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default UIDemoPage;

