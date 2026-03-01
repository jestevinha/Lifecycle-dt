package com.inknow.manusim.view;

import java.awt.GraphicsDevice;
import java.awt.GraphicsEnvironment;
import java.awt.event.WindowEvent;

import javax.swing.JFrame;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.control.ControlFrame;

public class ViewFrame extends javax.swing.JFrame {
	
	/**
	 * 
	 */
	private static final long serialVersionUID = 1L;
	private ControlFrame parent;
	private PlantPanel plantPanel;
	
	// Constructors
	
	public ViewFrame( ControlFrame parent ) {
		super();
		this.parent = parent;
		this.initComponents();
		this.plantPanel = new PlantPanel( this );
		this.add( this.plantPanel );
	}
	
	// other methods
	
	@SuppressWarnings("unused")
	private void initComponents() {
		this.setDefaultCloseOperation(javax.swing.WindowConstants.EXIT_ON_CLOSE);
		this.setTitle( Const.VIEW_FRAME_TITLE);
		this.setIconImage((new javax.swing.ImageIcon(Const.VIEW_FRAME_ICON)).getImage());

		switch (Const.VIEW_FRAME_MONITOR) {
		case 0: this.setBounds(Const.VIEW_FRAME_X, Const.VIEW_FRAME_Y, Const.VIEW_FRAME_WIDTH, Const.VIEW_FRAME_HEIGHT); 
		break;
		default: this.setBounds(Const.VIEW_FRAME_X, Const.VIEW_FRAME_Y, Const.VIEW_FRAME_WIDTH, Const.VIEW_FRAME_HEIGHT); 
		break;
		}
		this.setResizable(false);
		if ( Const.VIEW_FRAME_MONITOR == 1 ) {
			this.setUndecorated( true );
			this.showOnScreen( 1 , this );
		}
		this.setVisible(true);
		return;
	}
	
	public void showOnScreen( int screen, JFrame frame )
	{
	    GraphicsEnvironment ge = GraphicsEnvironment.getLocalGraphicsEnvironment();
	    GraphicsDevice[] gs = ge.getScreenDevices();
	    if( screen > -1 && screen < gs.length )
	    {
	        gs[screen].setFullScreenWindow( frame );
	    }
	    else if( gs.length > 0 )
	    {
	        gs[0].setFullScreenWindow( frame );
	    }
	    else
	    {
	        throw new RuntimeException( "No Screens Found" );
	    }
	    return;
	}
	
	@Override
	protected void processWindowEvent(WindowEvent e)
	{
		if (e.getID() != WindowEvent.WINDOW_DEACTIVATED) super.processWindowEvent(e);
		return;
	} 
	
	public ControlFrame getParent() {
		return this.parent;
	}
	
	public PlantPanel getPlantPanel() {
		return this.plantPanel;
	}

} // EOF
