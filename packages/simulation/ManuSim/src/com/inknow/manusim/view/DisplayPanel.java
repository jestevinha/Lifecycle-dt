package com.inknow.manusim.view;

import java.awt.Color;
import java.awt.Font;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;

import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingConstants;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.model.Workarea;

@SuppressWarnings("serial")
public class DisplayPanel extends javax.swing.JPanel {
	
	private int workareaId;
	// SWING elements
	private JLabel statusLabel = new JLabel();
	private JPanel wearStatusPanel = new JPanel();
	private JPanel pRateBar = new JPanel();
	private JPanel powerBarA = new JPanel();
	private JPanel powerBarB = new JPanel();
	private JPanel powerBarC = new JPanel();
	private JPanel powerBar = new JPanel();
	private JLabel productEnergyLabel = new JLabel();
	private JLabel numberAccidentsLabel = new JLabel();
	private DecimalFormat decimalFormatKWHu;
	
	// constructors
	
	public DisplayPanel(int workareaId) {
		super();
		this.workareaId = workareaId;
		this.decimalFormatKWHu = new DecimalFormat("#,##0.0 kWh/u");
		DecimalFormatSymbols custom = new DecimalFormatSymbols();
		custom.setGroupingSeparator(' ');
		this.decimalFormatKWHu.setDecimalFormatSymbols(custom);
		this.setLayout(null);
		initComponents();		
	}
	
	// other methods
	
	public void initComponents() {
		
		this.setBackground( java.awt.SystemColor.control );
		this.setSize( Const.PANEL_DP_WIDTH, Const.PANEL_DP_HEIGHT );
		this.setLocation( Const.PANEL_DP_X, Const.PANEL_DP_Y );
		
		int yaux = Const.LABEL_DP_GAP;
		JLabel auxLabel = new JLabel( "WA " + String.valueOf( this.workareaId ) , SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.BOLD, 10));
		add(auxLabel);
	    //--
		yaux += Const.LABEL_DP_HEIGHT + Const.LABEL_DP_GAP;
		auxLabel = new JLabel("ST:", SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.PLAIN, 9));
		this.add(auxLabel);
		//--
		this.statusLabel = new JLabel("ON", SwingConstants.LEFT);
		this.statusLabel.setBounds(20, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		this.statusLabel.setFont(new Font("Arial", Font.PLAIN, 11));
		this.statusLabel.setForeground(java.awt.Color.RED);
		this.add(this.statusLabel);
	    //--
		yaux += Const.LABEL_DP_HEIGHT + Const.LABEL_DP_GAP;
		auxLabel = new JLabel("OP:", SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.PLAIN, 9));
		this.add(auxLabel);
			
		this.wearStatusPanel = new JPanel();
		this.wearStatusPanel.setBounds(20, yaux, 5, Const.LABEL_DP_HEIGHT);
		this.wearStatusPanel.setBackground(Color.LIGHT_GRAY);
		this.add(this.wearStatusPanel);
	    //--
		yaux += Const.LABEL_DP_HEIGHT + Const.LABEL_DP_GAP;
		auxLabel = new JLabel("PR:", SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.PLAIN, 9));
		this.add(auxLabel);
			
		this.pRateBar = new JPanel();
		this.pRateBar.setBounds(20, yaux, 5, Const.LABEL_DP_HEIGHT);
		this.pRateBar.setBackground(Color.BLUE);
		this.add(this.pRateBar);
	    //--
		yaux += Const.LABEL_DP_HEIGHT + 2*Const.LABEL_DP_GAP;
		auxLabel = new JLabel("UA:", SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.PLAIN, 9));
		this.add(auxLabel);
		
		this.powerBarA = new JPanel();
		this.powerBarA.setBounds(20, yaux, 5, Const.LABEL_DP_HEIGHT);
		this.powerBarA.setBackground(Color.ORANGE);
		this.add(this.powerBarA);
		//--
		yaux += Const.LABEL_DP_HEIGHT + Const.LABEL_DP_GAP;
		auxLabel = new JLabel("UB:", SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.PLAIN, 9));
		this.add(auxLabel);
		
		this.powerBarB = new JPanel();
		this.powerBarB.setBounds(20, yaux, 5, Const.LABEL_DP_HEIGHT);
		this.powerBarB.setBackground(Color.ORANGE);
		this.add(this.powerBarB);
		// --
		yaux += Const.LABEL_DP_HEIGHT + Const.LABEL_DP_GAP;
		auxLabel = new JLabel("UC:", SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.PLAIN, 9));
		this.add(auxLabel);
		
		this.powerBarC = new JPanel();
		this.powerBarC.setBounds(20, yaux, 5, Const.LABEL_DP_HEIGHT);
		this.powerBarC.setBackground(Color.ORANGE);
		this.add(this.powerBarC);
		// --
		yaux += Const.LABEL_DP_HEIGHT + Const.LABEL_DP_GAP;
		auxLabel = new JLabel("EC:", SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.PLAIN, 9));
		this.add(auxLabel);
		
		this.powerBar = new JPanel();
		this.powerBar.setBounds(20, yaux, 5, Const.LABEL_DP_HEIGHT);
		this.powerBar.setBackground(Color.RED);
		this.add(this.powerBar);
		// --
		yaux += Const.LABEL_DP_HEIGHT + 2*Const.LABEL_DP_GAP;
		auxLabel = new JLabel("EP:", SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.PLAIN, 9));
		this.add(auxLabel);
		
		this.productEnergyLabel = new JLabel("0 kWh/u", SwingConstants.RIGHT);
		this.productEnergyLabel.setBounds(25, yaux, Const.LABEL_DP_WIDTH+20, Const.LABEL_DP_HEIGHT);
		this.productEnergyLabel.setFont(new Font("Arial", Font.PLAIN, 11));
		this.add(this.productEnergyLabel);	
		// --
		yaux += Const.LABEL_DP_HEIGHT + 2*Const.LABEL_DP_GAP;
		auxLabel = new JLabel("#Acc:", SwingConstants.LEFT);
		auxLabel.setBounds(2, yaux, Const.LABEL_DP_WIDTH, Const.LABEL_DP_HEIGHT);
		auxLabel.setFont(new Font("Arial", Font.PLAIN, 9));
		this.add(auxLabel);
		
		this.numberAccidentsLabel = new JLabel("0", SwingConstants.RIGHT);
		this.numberAccidentsLabel.setBounds(25, yaux, Const.LABEL_DP_WIDTH+20, Const.LABEL_DP_HEIGHT);
		this.numberAccidentsLabel.setFont(new Font("Arial", Font.PLAIN, 11));
		this.add(this.numberAccidentsLabel);	
		//
		return;
	}

	public void updateDisplayPanel( Workarea workarea) {	
		if ( workarea.getStatus() == Const.STATUS_ON ) {
			this.statusLabel.setText("ON");
			this.statusLabel.setForeground(java.awt.Color.RED);
		} else {
			this.statusLabel.setText("OFF");
			this.statusLabel.setForeground(java.awt.Color.BLACK);
		}
		this.wearStatusPanel.setSize( (int)( workarea.getUnitC().getWearStatus() * 70 / Const.NO_PARTS_WEAR_BREAKDOWN ), Const.LABEL_DP_HEIGHT ); // TODO
		this.pRateBar.setSize( (int) ( workarea.getCurrRate()*70), Const.LABEL_DP_HEIGHT ); // TODO
		this.powerBarA.setSize( (int) ( workarea.getUnitA().getCurrPower()/ workarea.getUnitA().getPowerMax()*70), Const.LABEL_DP_HEIGHT ); // TODO
		this.powerBarB.setSize( (int) ( workarea.getUnitB().getCurrPower()/ workarea.getUnitA().getPowerMax()*70), Const.LABEL_DP_HEIGHT ); // TODO
		this.powerBarC.setSize( (int) ( workarea.getUnitC().getCurrPower()/ workarea.getUnitA().getPowerMax()*70), Const.LABEL_DP_HEIGHT ); // TODO
		double power = workarea.getUnitA().getCurrPower() + workarea.getUnitB().getCurrPower() + workarea.getUnitC().getCurrPower();
		this.powerBar.setSize(( int) ( power / Const.POWER_MAX_WORKAREA * 70 ), Const.LABEL_DP_HEIGHT); // TODO
		
		if ( workarea.getStatus() == Const.STATUS_ON) {
			double productEnergyThis = power / 1000 / workarea.getCurrRate();
			this.productEnergyLabel.setText( this.decimalFormatKWHu.format( productEnergyThis ) );
		} else {
			this.productEnergyLabel.setText(" - ");
			this.productEnergyLabel.setForeground( new java.awt.Color( 0, 0, 0 ) );
		}
		this.numberAccidentsLabel.setText( String.valueOf( workarea.getNumberAccidents() ) ) ;
		return;
	}

} // EOF
