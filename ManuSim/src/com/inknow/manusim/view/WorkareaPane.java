package com.inknow.manusim.view;

import javax.swing.JLabel;
import javax.swing.JPanel;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.model.DayTime;


/** WorkareaPane is the object representing a production sector in the plant. 
*
* @author Rui Neves-Silva (UNINOVA - FCT/UNL)
* @version 1.0 Build 0001 Nov-2011/Feb-2013.
*/

@SuppressWarnings("serial")
public class WorkareaPane extends javax.swing.JLayeredPane{

	private int id;
	//
	private int status;
	private double skyExposure;
	//
	private JPanel backPanel;
	private JLabel shopfloorLabel;
	private JLabel statusLabel;
	//
	private DisplayPanel displayPanel;

	// constructors
	
	public WorkareaPane() {
		super();		
		this.setLayout(null);
		this.setBounds(0,0,0,0);
		this.id = -1;
		//
		this.skyExposure = 0.0;
		//
		this.backPanel = new JPanel();
		this.shopfloorLabel = new JLabel();
		this.statusLabel = new JLabel();
		
		this.displayPanel = new DisplayPanel( this.id );
	}

	public WorkareaPane(int id, double skyExposure) {
		super();		
		this.id = id;
		//
		this.skyExposure = skyExposure;
		//
		this.shopfloorLabel = new JLabel();
		this.shopfloorLabel.setIcon(new javax.swing.ImageIcon( Const.BACK_WORKAREA_FILE ));		
		int width = this.shopfloorLabel.getIcon().getIconWidth();
		int height = this.shopfloorLabel.getIcon().getIconHeight();
		this.shopfloorLabel.setBounds(0, 0, width, height);
		//				
		this.backPanel = new JPanel(); 		
		this.backPanel.setLayout(null);
		this.backPanel.setBounds(0, 0, width, height);
		this.backPanel.setBackground(ColorLevel.getWallColor());
		//		
		this.statusLabel = new JLabel();
		this.statusLabel.setBounds( Const.STATUS_X, Const.STATUS_Y, Const.STATUS_WIDTH, Const.STATUS_HEIGHT );
		this.setStatus( Const.STATUS_OFF );
		//
		this.setLayout(null);
		int x = (id % 10) * Const.WORKAREA_COORDINATES_M_X - Const.WORKAREA_COORDINATES_B_X;
		int y = (id / 10) * Const.WORKAREA_COORDINATES_M_Y - Const.WORKAREA_COORDINATES_B_Y;
		this.setBounds(x, y, width, height);
		//
		this.add( this.backPanel, 0 );
		this.add( this.shopfloorLabel, 0 );	
		this.add( this.statusLabel, 0 ); 
		this.displayPanel = new DisplayPanel( this.id );
		this.add( this.displayPanel, 0 );
	}

	// gets & sets
	
	public int getId() {
		return this.id;
	}

	public DisplayPanel getDisplayPanel() {
		return this.displayPanel;
	}
	
	public int getStatus() {
		return status;
	}

	// -- 

	public void setLightLevel(DayTime dayTime) {
		this.backPanel.setVisible(false);
		this.backPanel.setBackground( ColorLevel.getWallColorFactor( dayTime, this.skyExposure ) );
		this.backPanel.setVisible(true);
		return;
	}

	public void setSkyExposure(double skyExposure) {
		this.skyExposure = skyExposure;
		return;
	}
	
	public void setStatus(int status) {
		this.status = status;
		switch (this.status) {
		case Const.STATUS_OFF: 
			this.statusLabel.setIcon( new javax.swing.ImageIcon( Const.STATUS_OFF_FILE ) );
			break;
		case Const.STATUS_ON: 
			this.statusLabel.setIcon( new javax.swing.ImageIcon( Const.STATUS_ON_FILE ) );
			break;
		case Const.STATUS_FAILURE: 
			this.statusLabel.setIcon( new javax.swing.ImageIcon( Const.STATUS_FAILURE_FILE ) );
			break;
		case Const.STATUS_MAINTENANCE: 
			this.statusLabel.setIcon( new javax.swing.ImageIcon( Const.STATUS_MAINTENANCE_FILE ) );
			break;
		case Const.STATUS_ACCIDENT: 
			this.statusLabel.setIcon( new javax.swing.ImageIcon( Const.STATUS_ACCIDENT_FILE ) );
			break;
		default:
			this.statusLabel.setIcon( new javax.swing.ImageIcon( Const.STATUS_OFF_FILE ) );
		}
		return;
	}
	
} // EOF
